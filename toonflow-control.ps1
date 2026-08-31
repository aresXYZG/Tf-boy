<# 
Toonflow 一键启动/关闭/重启脚本（Windows PowerShell）

使用方式：
1) 双击同目录下的 toonflow-control.cmd（推荐）
2) 或在 PowerShell 里执行：.\toonflow-control.ps1

说明：
- 自适应两种目录结构：
  A) 完整发行包：根目录含 Toonflow-app（后端）+ Toonflow-web（前端）→ 前后端一起启动
  B) 单项目（当前目录即 Toonflow-app 后端）→ 仅启动后端
- 进程 PID 会写入 .run\toonflow-pids.json，方便下次停止/重启
- 路径均使用相对当前脚本目录，移动项目文件夹后仍可用
- 若后端依赖未安装（node_modules 缺失），会提示先执行 npm install
#>

[CmdletBinding()]
param(
  [switch]$Restart
)

Set-StrictMode -Version Latest
$ErrorActionPreference = "Stop"

function Write-Info([string]$msg) { Write-Host "[INFO] $msg" -ForegroundColor Cyan }
function Write-Warn([string]$msg) { Write-Host "[WARN] $msg" -ForegroundColor Yellow }
function Write-Err([string]$msg)  { Write-Host "[ERR ] $msg" -ForegroundColor Red }

$Root = $PSScriptRoot
# 自适应：完整发行包（根目录下有 Toonflow-app 子目录）→ 用它作后端目录；
# 否则认为当前目录就是 Toonflow-app 后端本体
$IsBundle = Test-Path (Join-Path $Root "Toonflow-app")
if ($IsBundle) {
  $AppDir = Join-Path $Root "Toonflow-app"
} else {
  $AppDir = $Root
}
$WebDir = Join-Path $Root "Toonflow-web"
$HasWeb = Test-Path $WebDir
$AppName = Split-Path $AppDir -Leaf

$RunDir = Join-Path $Root ".run"
$PidFile = Join-Path $RunDir "toonflow-pids.json"
$LogDir = Join-Path $RunDir "logs"

function Ensure-LocalNodeOnPath {
  # 1) 首选：项目内置 Node（发行包自带 node-v24.11.1-win-x64）
  $nodeDir = Join-Path $Root "node-v24.11.1-win-x64"
  if (Test-Path $nodeDir) {
    if ($env:TOONFLOW_USE_LOCAL_NODE -eq "0") { return $true }

    $npmDir = Join-Path $nodeDir "npm"
    $env:PATH = "$nodeDir;$npmDir;$env:PATH"
    Write-Info "Updated PATH to include local node: $nodeDir"

    $corepack = Join-Path $nodeDir "corepack.cmd"
    if (Test-Path $corepack) {
      try { & $corepack enable | Out-Null } catch { }
    }
    return
  }

  # 2) 备选：WorkBuddy 托管 Node 22（本机开发环境，避免 nvm 里只有旧版 Node）
  $wbNode = Join-Path $env:USERPROFILE ".workbuddy\binaries\node\versions\22.22.2"
  if (Test-Path (Join-Path $wbNode "node.exe")) {
    $env:PATH = "$wbNode;$env:PATH"
    Write-Info "使用 WorkBuddy 托管 Node：$wbNode"
  }

  # 3) 版本兜底检查：Toonflow 需要 Node 20+（better-sqlite3 12.x / electron 40）
  #    用 try/catch 包裹：老版本 Node（如 16）可能因 NODE_OPTIONS 不兼容直接崩溃，
  #    其 stderr 在 $ErrorActionPreference=Stop 下会终止脚本，必须容错
  $nodeMajor = 0
  try { $nodeMajor = [int]((& node -v 2>&1) -replace '^v(\d+).*', '$1') } catch { $nodeMajor = 0 }
  if ($nodeMajor -lt 20) {
    Write-Err "当前 Node 版本过旧：$(& node -v 2>&1)（需要 Node 20+，建议 22）。"
    Write-Warn "请任选其一："
    Write-Host "  A) nvm install 22 后执行 nvm use 22"
    Write-Host "  B) 在项目目录放置内置 Node（node-v24.11.1-win-x64）"
    Write-Warn "解决版本后重新运行本脚本。"
    return $false
  }
  Write-Info "Node 版本检查通过：$(& node -v 2>&1)"
  return $true
}

function Read-Pids {
  if (!(Test-Path $PidFile)) { return $null }
  try {
    return Get-Content $PidFile -Raw -Encoding UTF8 | ConvertFrom-Json
  } catch {
    return $null
  }
}

function Write-Pids($obj) {
  if (!(Test-Path $RunDir)) { New-Item -ItemType Directory -Force -Path $RunDir | Out-Null }
  ($obj | ConvertTo-Json -Depth 8) | Set-Content -Path $PidFile -Encoding UTF8
}

function Remove-PidsFile {
  if (Test-Path $PidFile) { Remove-Item -Force $PidFile }
}

function Get-ListeningPids([int[]]$Ports) {
  $result = New-Object System.Collections.Generic.HashSet[int]
  $netstatOut = netstat -ano | Select-String "LISTENING"
  foreach ($line in $netstatOut) {
    $parts = @($line.ToString() -split '\s+' | Where-Object { $_ -ne '' })
    if ($parts.Count -ge 5) {
      $localAddr = $parts[1]
      $procId = $parts[4]
      foreach ($p in $Ports) {
        if ($localAddr -match ":$p$") {
          [void]$result.Add([int]$procId)
        }
      }
    }
  }
  $pids = @()
  foreach ($x in $result) { $pids += [int]$x }
  return $pids
}

function Test-PortListening([int]$Port) {
  try {
    $netstatOut = @(netstat -ano | Select-String "LISTENING" | Select-String ":$Port\b")
    return ($netstatOut.Count -gt 0)
  } catch {
    return $false
  }
}

function Wait-ForPorts([int[]]$Ports, [int]$TimeoutSeconds = 30) {
  $deadline = (Get-Date).AddSeconds($TimeoutSeconds)
  while ((Get-Date) -lt $deadline) {
    $allOk = $true
    foreach ($p in $Ports) {
      if (!(Test-PortListening -Port $p)) { $allOk = $false; break }
    }
    if ($allOk) { return $true }
    Start-Sleep -Milliseconds 800
  }
  return $false
}

function Kill-ProcessTree([int]$ProcessId, [string]$Why) {
  # 注意：PowerShell 内置只读变量 $PID（当前进程号）大小写不敏感，
  # 因此参数/变量名不能用 Pid，否则会触发“无法覆盖变量 PID”错误。
  if ($ProcessId -le 0) { return }
  $p = Get-Process -Id $ProcessId -ErrorAction SilentlyContinue
  if (!$p) { return }
  Write-Info "结束进程 PID=$ProcessId（$Why）"
  # /T: kill child processes as well
  & taskkill.exe /PID $ProcessId /T /F | Out-Null
}

function Start-ServiceProcess([string]$Name, [string]$WorkDir, [string]$Command, [string]$LogFile) {
  if (!(Test-Path $WorkDir)) { throw "目录不存在：$WorkDir" }
  if (!(Test-Path $LogDir)) { New-Item -ItemType Directory -Force -Path $LogDir | Out-Null }

  # 使用 cmd.exe 执行命令并将输出重定向到日志文件，后台运行不显示窗口
  # 使用单一字符串作为 ArgumentList，避免 PowerShell 数组带来的自动引号转义问题
  $argStr = "/c `"$Command > `"$LogFile`" 2>&1`""

  $p = Start-Process -FilePath "cmd.exe" -ArgumentList $argStr -WorkingDirectory $WorkDir -PassThru -WindowStyle Hidden
  Write-Info "$Name 已启动，PID=$($p.Id) (后台运行)"
  return $p.Id
}

function Start-Toonflow {
  # Node 版本保障：过旧则中止并提示（better-sqlite3/electron 需要 Node 20+）
  if (!(Ensure-LocalNodeOnPath)) { return }

  # 依赖检查：node_modules 缺失时提示先安装，避免“启动看似成功其实起不来”
  $nodeModules = Join-Path $AppDir "node_modules"
  if (!(Test-Path $nodeModules)) {
    Write-Err "未检测到依赖目录：$nodeModules"
    Write-Warn "请先在 PowerShell 中进入 $AppDir 并执行："
    Write-Host "  npm install"
    Write-Warn "安装完成后再重新运行本脚本。"
    return
  }

  # 确定 npm 的执行路径，优先使用自带的 npm.cmd
  $NpmCmd = "npm"
  $localNpm = Join-Path $Root "node-v24.11.1-win-x64\npm.cmd"
  if (Test-Path $localNpm) {
    if ($env:TOONFLOW_USE_LOCAL_NODE -ne "0") {
      $NpmCmd = "`"$localNpm`""
    }
  }

  $existing = Read-Pids
  if ($existing -ne $null) {
    $backendAlive = $false
    $frontendAlive = $false
    try { if ($existing.backend.pid) { $backendAlive = $null -ne (Get-Process -Id ([int]$existing.backend.pid) -ErrorAction SilentlyContinue) } } catch { }
    try { if ($existing.frontend.pid) { $frontendAlive = $null -ne (Get-Process -Id ([int]$existing.frontend.pid) -ErrorAction SilentlyContinue) } } catch { }

    if ($backendAlive -or $frontendAlive) {
      Write-Warn "检测到已有 PID 文件且进程仍在运行：$PidFile"
      $listen10588 = Test-PortListening -Port 10588
      if ($HasWeb) {
        $listen50190 = Test-PortListening -Port 50190
        Write-Warn "端口监听状态：10588=$listen10588, 50190=$listen50190"
      } else {
        Write-Warn "端口监听状态：10588=$listen10588"
      }
      Write-Warn "建议：直接选择 3) 重启，或先选 2) 关闭，再启动。"
      return
    } else {
      Write-Warn "检测到 PID 文件但进程已不在运行，将自动清理：$PidFile"
      Remove-PidsFile
    }
  }

  # 端口占用时，为避免“启动看似成功但其实起不来”，先提示用户改走重启
  $checkPorts = @(10588)
  if ($HasWeb) { $checkPorts += 50190 }
  if (Test-PortListening -Port 10588 -or ($HasWeb -and (Test-PortListening -Port 50190))) {
    Write-Warn "检测到 10588$(if ($HasWeb) { ' 或 50190' }) 端口已被占用。"
    Write-Warn "建议：选择 3) 重启（会先关闭占用端口的进程）。"
    return
  }

  $stamp = (Get-Date).ToString("yyyyMMdd-HHmmss")
  $backendLog = Join-Path $LogDir "backend-$stamp.log"
  $frontendLog = Join-Path $LogDir "frontend-$stamp.log"

  # 部分供应商（如 yunwu）在本机需要走代理才能访问；检测到本机代理时自动给后端带上
  $proxyOn = $false
  try { $proxyOn = Test-PortListening -Port 7890 } catch { $proxyOn = $false }
  if ($proxyOn) {
    $env:NODE_USE_ENV_PROXY = "1"
    $env:HTTPS_PROXY = "http://127.0.0.1:7890"
    $env:NO_PROXY = "127.0.0.1,localhost,::1"
    Write-Info "检测到本机代理 127.0.0.1:7890，后端将走代理访问网络"
  } else {
    Remove-Item Env:NODE_USE_ENV_PROXY, Env:HTTPS_PROXY, Env:NO_PROXY -ErrorAction SilentlyContinue
  }

  $backendPid = Start-ServiceProcess -Name "后端($AppName)" -WorkDir $AppDir -Command "$NpmCmd run dev" -LogFile $backendLog

  $pidsHash = @{
    createdAt = (Get-Date).ToString("s")
    backend   = @{ pid = $backendPid; cwd = $AppName; cmd = "$NpmCmd run dev"; log = (Split-Path $backendLog -Leaf) }
  }

  # 前端不需要代理，清掉避免影响其他进程
  Remove-Item Env:NODE_USE_ENV_PROXY, Env:HTTPS_PROXY, Env:NO_PROXY -ErrorAction SilentlyContinue
  if ($HasWeb) {
    $frontendPid = Start-ServiceProcess -Name "前端(Toonflow-web)" -WorkDir $WebDir -Command "$NpmCmd run dev" -LogFile $frontendLog
    $pidsHash.frontend = @{ pid = $frontendPid; cwd = "Toonflow-web"; cmd = "$NpmCmd run dev"; log = (Split-Path $frontendLog -Leaf) }
  } else {
    Write-Warn "未找到 Toonflow-web 目录，本次仅启动后端。"
  }

  Write-Pids $pidsHash

  Write-Info "已写入 PID 文件：$PidFile"
  if ($HasWeb) {
    Write-Info "默认端口：前端 http://localhost:50190/  后端 http://localhost:10588"
  } else {
    Write-Info "默认端口：后端 http://localhost:10588"
  }

  # 健康检查：等待端口真正起来，否则提示看日志
  $waitPorts = @(10588)
  if ($HasWeb) { $waitPorts += 50190 }
  if (Wait-ForPorts -Ports $waitPorts -TimeoutSeconds 35) {
    Write-Info "启动检查通过：端口已监听。"
  } else {
    Write-Warn "启动后未检测到端口监听（可能启动失败或正在初始化）。"
    Write-Warn "请查看日志："
    Write-Host "  $backendLog"
    Write-Host "  $frontendLog"
  }
}

function Stop-Toonflow {
  $pidsObj = Read-Pids
  $killedAny = $false

  if ($pidsObj -ne $null) {
    try { if ($pidsObj.backend.pid)  { Kill-ProcessTree -ProcessId ([int]$pidsObj.backend.pid)  -Why "后端($AppName)"; $killedAny = $true } } catch { }
    try { if ($pidsObj.frontend.pid) { Kill-ProcessTree -ProcessId ([int]$pidsObj.frontend.pid) -Why "前端(Toonflow-web)"; $killedAny = $true } } catch { }
    Remove-PidsFile
  }

  # 如果没有 PID 文件或 PID 已失效：再按端口兜底（尽量只杀 Toonflow）
  $stopPorts = @(10588)
  if ($HasWeb) { $stopPorts += 50190 }
  $portPids = @(Get-ListeningPids -Ports $stopPorts)
  foreach ($portPid in $portPids) {
    Kill-ProcessTree -ProcessId $portPid -Why "端口兜底($($stopPorts -join '/'))"
    $killedAny = $true
  }

  if ($killedAny) {
    Write-Info "已尝试关闭 Toonflow 相关进程。"
  } else {
    Write-Warn "未检测到可关闭的 Toonflow 进程（可能已经停止）。"
  }
}

function Restart-Toonflow {
  Stop-Toonflow
  Start-Sleep -Seconds 1
  Start-Toonflow
}

function Show-Status {
  $pidsObj = Read-Pids
  if ($pidsObj -ne $null) {
    Write-Info "PID 文件存在：$PidFile"
    foreach ($k in @("backend","frontend")) {
      if ($k -eq "frontend" -and -not $HasWeb) { continue }
      try {
        $procPid = [int]$pidsObj.$k.pid
        if ($procPid -gt 0 -and (Get-Process -Id $procPid -ErrorAction SilentlyContinue)) {
          Write-Host "  ${k}: running (PID=$procPid)"
        } else {
          Write-Host "  ${k}: not running (PID=$procPid)"
        }
      } catch {
        Write-Host "  ${k}: unknown (PID not found in file)"
      }
    }
  } else {
    Write-Warn "未找到 PID 文件。"
  }

  $statusPorts = @(10588)
  if ($HasWeb) { $statusPorts += 50190 }
  $portPids = @(Get-ListeningPids -Ports $statusPorts)
  if ($portPids.Count -gt 0) {
    Write-Info "监听端口($($statusPorts -join '/'))的进程 PID：$($portPids -join ', ')"
  } else {
    Write-Info "未检测到监听端口($($statusPorts -join '/'))的进程。"
  }
}

function Show-Menu {
  while ($true) {
    Write-Host ""
    Write-Host "========== Toonflow 控制台 =========="
    Write-Host "1) 启动（前端+后端）"
    Write-Host "2) 关闭（前端+后端）"
    Write-Host "3) 重启（关闭后再启动）"
    Write-Host "4) 状态"
    Write-Host "0) 退出"
    Write-Host "====================================="
    $choice = Read-Host "请选择"
    if ([string]::IsNullOrWhiteSpace($choice)) { break }
    switch ($choice) {
      "1" { Start-Toonflow }
      "2" { Stop-Toonflow }
      "3" { Restart-Toonflow }
      "4" { Show-Status }
      "0" { break }
      default { Write-Warn "无效选项：$choice" }
    }
  }
}

if ($Restart) { Restart-Toonflow } else { Show-Menu }


