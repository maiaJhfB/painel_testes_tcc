$ErrorActionPreference = 'Stop'
$DemoRoot = $PSScriptRoot
$DemoRuntime = Join-Path $DemoRoot '.runtime'

function Get-DemoProcessState($Record) {
    $recordPid = 0
    $recordTicks = [long]0
    if (-not $Record -or $Record.root -ne $DemoRoot -or -not $Record.executable -or -not $Record.instance -or
        -not [int]::TryParse([string]$Record.processId, [ref]$recordPid) -or $recordPid -le 0 -or
        -not [long]::TryParse([string]$Record.started, [ref]$recordTicks) -or $recordTicks -le 0) {
        return [pscustomobject]@{state='Unknown';process=$null}
    }
    try { $owned = Get-Process -Id $recordPid -ErrorAction Stop }
    catch {
        if ($_.CategoryInfo.Category -eq 'ObjectNotFound' -and $_.FullyQualifiedErrorId -like 'NoProcessFoundForGivenId,*') {
            return [pscustomobject]@{state='Absent';process=$null}
        }
        return [pscustomobject]@{state='Unknown';process=$null}
    }
    if (-not $owned) { return [pscustomobject]@{state='Unknown';process=$null} }
    try {
        if ($owned.StartTime.ToUniversalTime().Ticks -ne $recordTicks) {
            return [pscustomobject]@{state='ReusedPid';process=$null}
        }
        if (-not $owned.Path -or $owned.Path -ne $Record.executable) {
            return [pscustomobject]@{state='Unknown';process=$null}
        }
    } catch { return [pscustomobject]@{state='Unknown';process=$null} }
    return [pscustomobject]@{state='Owned';process=$owned}
}

function Get-OwnedDemoProcess($Record) {
    $identity = Get-DemoProcessState $Record
    if ($identity.state -eq 'Owned') { return $identity.process }
    return $null
}

function Save-DemoProcess($Process, [string]$Name, [string]$Instance, [int]$Port) {
    $live = $null
    for ($attempt=0; $attempt -lt 20; $attempt++) {
        $live = Get-Process -Id $Process.Id -ErrorAction Stop
        if ($live.Path) { break }
        Start-Sleep -Milliseconds 100
    }
    if (-not $live.Path) { throw 'Nao foi possivel registrar o executavel do processo criado.' }
    $record = @{ root=$DemoRoot; processId=$live.Id;
        started=$live.StartTime.ToUniversalTime().Ticks.ToString();
        executable=$live.Path; instance=$Instance; port=$Port }
    $record | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $DemoRuntime "$Name.process.json") -Encoding UTF8
}

function Assert-DemoPortFree([int]$Port) {
    $probe = [Net.Sockets.TcpListener]::new([Net.IPAddress]::Any, $Port)
    try { $probe.Start() }
    catch { throw "A porta $Port esta ocupada ou indisponivel. O processo existente foi preservado; escolha outra porta ou encerre manualmente a sua sessao anterior." }
    finally { $probe.Stop() }
}
