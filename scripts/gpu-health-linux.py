"""One read-only snapshot. Runs over SSH stdin; no install, daemon, or writes."""
import glob
import json
import os
import re
import shutil
import subprocess
import time
import xml.etree.ElementTree as ET

limitations = []


def run(args, label, timeout=5):
    try:
        result = subprocess.run(args, capture_output=True, text=True, timeout=timeout)
        if result.returncode:
            limitations.append(label + " unavailable: " + (result.stderr.strip() or result.stdout.strip())[:180])
            return None
        return result.stdout
    except (OSError, subprocess.TimeoutExpired):
        limitations.append(label + " unavailable or timed out.")
        return None


def number(value):
    match = re.match(r"^-?\d+(?:\.\d+)?", str(value or ""))
    return float(match.group()) if match else None


def read(filename):
    with open(filename) as file:
        return file.read().strip()


def cpu_sample():
    # Guest time is already included in user/nice; exclude those extra fields.
    values = list(map(int, read("/proc/stat").splitlines()[0].split()[1:9]))
    return sum(values), values[3] + values[4]


before = cpu_sample()
time.sleep(0.25)
after = cpu_sample()
delta = after[0] - before[0]
cpu_use = round(100 * (1 - (after[1] - before[1]) / delta), 1) if delta else None
mem = {line.split(":")[0]: int(line.split()[1]) / 1024 for line in read("/proc/meminfo").splitlines()}
cpu_name = next((line.split(":", 1)[1].strip() for line in read("/proc/cpuinfo").splitlines() if line.startswith("model name")), os.uname().machine)
cpu_temps = []
for path in glob.glob("/sys/class/hwmon/hwmon*"):
    try:
        name = read(path + "/name").lower()
        if any(word in name for word in ("coretemp", "k10temp", "cpu", "soc")):
            for sensor in glob.glob(path + "/temp*_input"):
                cpu_temps.append(float(read(sensor)) / 1000)
    except (OSError, ValueError):
        continue

os_name = os.uname().sysname
for line in read("/etc/os-release").splitlines():
    if line.startswith("PRETTY_NAME="):
        os_name = line.split("=", 1)[1].strip('"')
if "microsoft" in os.uname().release.lower():
    os_name += " · WSL2"
    limitations.append("CPU, RAM, disk and OS updates describe the WSL environment, not the Windows host.")

gpus = []
driver = None
cuda = None
xml = run(["nvidia-smi", "-q", "-x"], "GPU readings")
if xml:
    root = ET.fromstring(xml)
    driver = root.findtext("driver_version")
    cuda = root.findtext("cuda_version")
    for gpu in root.findall("gpu"):
        def metric(path):
            return number(gpu.findtext(path))

        temperature = metric("temperature/gpu_temp")
        headroom = metric("temperature/gpu_temp_tlimit")
        slowdown_at = metric("temperature/gpu_temp_slow_threshold")
        if headroom is None and slowdown_at is not None and temperature is not None:
            headroom = slowdown_at - temperature
        thermal = [item.text for item in gpu.iter() if item.tag.endswith("thermal_slowdown") and item.text in ("Active", "Not Active")]
        power = metric("gpu_power_readings/average_power_draw")
        if power is None:
            power = metric("power_readings/power_draw")
        power_limit = metric("gpu_power_readings/current_power_limit")
        if power_limit is None:
            power_limit = metric("power_readings/power_limit")
        gpus.append({
            "name": gpu.findtext("product_name"),
            "utilization": metric("utilization/gpu_util"),
            "temperatureC": temperature,
            "thermalHeadroomC": headroom,
            "thermalSlowdown": "Active" in thermal if thermal else None,
            "memoryUsedMiB": metric("fb_memory_usage/used"),
            "memoryTotalMiB": metric("fb_memory_usage/total"),
            "powerW": power,
            "powerLimitW": power_limit,
            "fanPercent": metric("fan_speed"),
            "uncorrectedErrors": metric("ecc_errors/volatile/uncorrectable/total"),
        })

disks = []
mounts = ["/"]
# Read the mount table, not the contents of model or data directories.
for line in read("/proc/mounts").splitlines():
    fields = line.split()
    if fields[0].startswith("/dev/") and fields[1].startswith(("/home", "/data", "/mnt", "/srv")):
        mount = fields[1].replace("\\040", " ")
        if mount not in mounts:
            mounts.append(mount)
for mount in mounts:
    try:
        usage = shutil.disk_usage(mount)
        disks.append({"mount": mount, "totalGiB": round(usage.total / 2**30, 1), "freeGiB": round(usage.free / 2**30, 1)})
    except OSError:
        limitations.append("Disk readings unavailable for " + mount)

updates = {"pending": None, "security": None, "checkedAt": None, "rebootRequired": os.path.exists("/var/run/reboot-required"), "source": "Local APT package lists; no repository refresh"}
if shutil.which("apt"):
    packages = run(["apt", "list", "--upgradable"], "Package updates")
    if packages is not None:
        rows = [line for line in packages.splitlines() if "[upgradable from:" in line]
        updates["pending"] = len(rows)
        updates["security"] = sum("-security" in line for line in rows)
        stamps = [os.path.getmtime(path) for path in glob.glob("/var/lib/apt/lists/*InRelease")]
        updates["checkedAt"] = int(max(stamps)) if stamps else None
else:
    updates["source"] = "Package update information unavailable on this OS"

services = []
if shutil.which("systemctl"):
    failed = run(["systemctl", "--failed", "--no-legend", "--plain", "--no-pager"], "Failed services")
    if failed:
        for line in failed.splitlines():
            fields = line.split()
            if len(fields) >= 4:
                services.append({"name": fields[0], "state": fields[3]})

events = []
if shutil.which("journalctl"):
    journal = run(["journalctl", "-k", "--since", "24 hours ago", "-p", "0..3", "-n", "30", "-o", "json", "--no-pager", "-q"], "Kernel error log")
    if journal is not None:
        for line in journal.splitlines():
            if line.startswith("{"):
                event = json.loads(line)
                message = event.get("MESSAGE", "")
                if isinstance(message, str):
                    events.append({"at": int(event["__REALTIME_TIMESTAMP"]) // 1000000, "message": message[:350]})
else:
    limitations.append("Kernel error log unavailable on this OS.")

print(json.dumps({
    "schema": 1, "os": os_name, "uptimeSeconds": int(float(read("/proc/uptime").split()[0])),
    "cpu": {"name": cpu_name, "cores": os.cpu_count(), "utilization": cpu_use, "temperatureC": max(cpu_temps) if cpu_temps else None, "load1": os.getloadavg()[0]},
    "memory": {"totalMiB": mem["MemTotal"], "availableMiB": mem["MemAvailable"], "swapUsedMiB": mem.get("SwapTotal", 0) - mem.get("SwapFree", 0)},
    "disks": disks, "driver": driver, "cuda": cuda, "gpus": gpus,
    "updates": updates, "services": services, "events": events, "limitations": limitations,
}))
