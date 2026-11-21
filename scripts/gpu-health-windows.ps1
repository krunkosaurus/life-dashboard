$ErrorActionPreference = 'Stop'
$ProgressPreference = 'SilentlyContinue'
$limitations = [System.Collections.Generic.List[string]]::new()
function Metric($node, $path) {
    $item = $node.SelectSingleNode($path)
    if ($null -ne $item -and $item.InnerText -match '^-?\d+(\.\d+)?') {
        return [double]::Parse($Matches[0], [Globalization.CultureInfo]::InvariantCulture)
    }
    return $null
}
function Epoch($date) { return [long](([DateTimeOffset]$date).ToUnixTimeSeconds()) }
$os = Get-CimInstance Win32_OperatingSystem
$processors = @(Get-CimInstance Win32_Processor)
$gpus = @()
$driver = $null
$cuda = $null
try {
    [xml]$xml = (& nvidia-smi -q -x | Out-String)
    if ($LASTEXITCODE -ne 0) { throw 'NVIDIA driver query failed' }
    $driver = [string]$xml.nvidia_smi_log.driver_version
    $cuda = [string]$xml.nvidia_smi_log.cuda_version
    foreach ($gpu in $xml.nvidia_smi_log.gpu) {
        $temperature = Metric $gpu 'temperature/gpu_temp'
        $headroom = Metric $gpu 'temperature/gpu_temp_tlimit'
        $slowAt = Metric $gpu 'temperature/gpu_temp_slow_threshold'
        if ($null -eq $headroom -and $null -ne $slowAt -and $null -ne $temperature) { $headroom = $slowAt - $temperature }
        $thermal = @($gpu.SelectNodes('.//*') | Where-Object { $_.Name -match 'thermal_slowdown$' -and $_.InnerText -in @('Active', 'Not Active') })
        $thermalSlowdown = $null
        if ($thermal.Count -gt 0) { $thermalSlowdown = @($thermal | Where-Object { $_.InnerText -eq 'Active' }).Count -gt 0 }
        $power = Metric $gpu 'gpu_power_readings/average_power_draw'
        if ($null -eq $power) { $power = Metric $gpu 'power_readings/power_draw' }
        $limit = Metric $gpu 'gpu_power_readings/current_power_limit'
        if ($null -eq $limit) { $limit = Metric $gpu 'power_readings/power_limit' }
        $gpus += @{
            name = [string]$gpu.product_name; utilization = (Metric $gpu 'utilization/gpu_util')
            temperatureC = $temperature; thermalHeadroomC = $headroom; thermalSlowdown = $thermalSlowdown
            memoryUsedMiB = (Metric $gpu 'fb_memory_usage/used'); memoryTotalMiB = (Metric $gpu 'fb_memory_usage/total')
            powerW = $power; powerLimitW = $limit; fanPercent = (Metric $gpu 'fan_speed')
            uncorrectedErrors = (Metric $gpu 'ecc_errors/volatile/uncorrectable/total')
        }
    }
} catch { $limitations.Add('GPU readings unavailable: ' + $_.Exception.Message) }
$disks = @(Get-CimInstance Win32_LogicalDisk -Filter 'DriveType=3' | ForEach-Object {
    @{ mount = $_.DeviceID; totalGiB = [math]::Round($_.Size / 1GB, 1); freeGiB = [math]::Round($_.FreeSpace / 1GB, 1) }
})
$updates = @{
    pending = $null; security = $null; checkedAt = $null
    rebootRequired = (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\RebootRequired') -or (Test-Path 'HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Component Based Servicing\RebootPending')
    source = 'Cached Windows Update results; no online scan'
}
try {
    $session = New-Object -ComObject Microsoft.Update.Session
    $searcher = $session.CreateUpdateSearcher()
    $searcher.Online = $false
    $result = $searcher.Search("IsInstalled=0 and IsHidden=0 and Type='Software'")
    $updates.pending = $result.Updates.Count
    $updates.security = @($result.Updates | Where-Object { @($_.Categories | Where-Object { $_.CategoryID -eq '0fa1201d-4330-4fa8-8ae9-b877473b6441' }).Count -gt 0 }).Count
    $lastSearch = (New-Object -ComObject Microsoft.Update.AutoUpdate).Results.LastSearchSuccessDate
    if ($lastSearch.Year -gt 2000) { $updates.checkedAt = Epoch ([DateTime]::SpecifyKind($lastSearch, 'Utc')) }
} catch { $limitations.Add('Cached Windows Update information unavailable.') }
$events = @()
try {
    $events = @(Get-WinEvent -FilterHashtable @{LogName='System'; Level=1,2; StartTime=(Get-Date).AddHours(-24)} -MaxEvents 30 -ErrorAction Stop | ForEach-Object {
        $message = $_.ProviderName + ': ' + $_.Message
        @{at=(Epoch $_.TimeCreated); message=$message.Substring(0, [math]::Min(350, $message.Length))}
    })
} catch {
    if ($_.FullyQualifiedErrorId -notlike 'NoMatchingEventsFound*') { $limitations.Add('System error log unavailable.') }
}
$cpuLoad = $processors | Measure-Object -Property LoadPercentage -Average
$cpuUse = $null
if ($null -ne $cpuLoad.Average) { $cpuUse = [math]::Round($cpuLoad.Average, 1) }
$snapshot = @{
    schema = 1; os = $os.Caption; uptimeSeconds = [long]((Get-Date) - $os.LastBootUpTime).TotalSeconds
    cpu = @{name=$processors[0].Name; cores=($processors | Measure-Object -Property NumberOfLogicalProcessors -Sum).Sum; utilization=$cpuUse; temperatureC=$null; load1=$null}
    memory = @{totalMiB=$os.TotalVisibleMemorySize / 1024; availableMiB=$os.FreePhysicalMemory / 1024; swapUsedMiB=$null}
    disks=$disks; driver=$driver; cuda=$cuda; gpus=$gpus; updates=$updates
    services=@(); events=$events; limitations=@($limitations.ToArray())
}
$snapshot | ConvertTo-Json -Depth 8 -Compress
