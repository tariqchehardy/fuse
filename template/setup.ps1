$ErrorActionPreference = 'Stop'
$report = New-Object System.Collections.Generic.List[string]

# --- 1. Operating system confirmation ---
$cv = Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion'
$report.Add("OS: $($cv.ProductName) | version $($cv.DisplayVersion) | build $($cv.CurrentBuildNumber) | 64-bit: $([Environment]::Is64BitOperatingSystem)")

# --- 2. SovereignUser account creation ---
$pw = $env:SOVEREIGN_USER_PW
if ([string]::IsNullOrEmpty($pw)) { throw 'SOVEREIGN_USER_PW secret missing; user creation cannot proceed.' }
net user SovereignUser $pw /add /passwordchg:no /expires:never /fullname:"Sovereign Workstation Operator" /comment:"Dedicated admin account mirroring the production sovereign-workstation runner" | Out-Null
net localgroup Administrators SovereignUser /add | Out-Null
$user = net user SovereignUser
$report.Add('USER: ' + (($user | Select-String 'Account active').ToString().Trim()))
$report.Add('USER: ' + (($user | Select-String 'Password expires').ToString().Trim()))
$admins = net localgroup Administrators
$report.Add('GROUP: SovereignUser member of Administrators: ' + [bool]($admins | Select-String 'SovereignUser'))

# --- 3. RDP configuration ---
Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server' -Name fDenyTSConnections -Value 0 -Type DWord
Set-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp' -Name UserAuthentication -Value 1 -Type DWord
$report.Add('RDP: fDenyTSConnections=' + (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server').fDenyTSConnections + ' (0 = connections permitted)')
$report.Add('RDP: NLA UserAuthentication=' + (Get-ItemProperty 'HKLM:\SYSTEM\CurrentControlSet\Control\Terminal Server\WinStations\RDP-Tcp').UserAuthentication + ' (1 = Network Level Authentication required)')

# --- 4. TermService and 3389 listener ---
$svc = Get-Service TermService -ErrorAction SilentlyContinue
if ($svc) {
    Set-Service TermService -StartupType Manual
    try { Start-Service TermService -ErrorAction Stop; Start-Sleep 3 } catch { $report.Add('TermService start: ' + $_.Exception.Message) }
    $report.Add('TermService status: ' + (Get-Service TermService).Status)
} else {
    $report.Add('TermService: not installed in this container image')
}
$listener = netstat -an | Select-String ':3389\s'
$report.Add('LISTENER 3389: ' + $(if ($listener) { ($listener -join ' | ').Trim() } else { 'not listening (Windows containers cannot host an RDP session host; registry staged for VM-based environments)' }))

$report | ForEach-Object { Write-Host $_ }
$report | Set-Content 'C:\sovereign-setup-report.txt' -Encoding ASCII
Write-Host 'Report saved to C:\sovereign-setup-report.txt'
