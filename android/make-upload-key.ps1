# Ключ загрузки для Google Play — создаётся один раз.
#
# Запуск из папки проекта:  powershell -ExecutionPolicy Bypass -File android\make-upload-key.ps1
#
# Создаёт android\amber-upload.jks и android\keystore.properties (оба в .gitignore, в репозиторий не попадают).
# После этого «npm run aab» собирает подписанный android\app\build\outputs\bundle\release\app-release.aab.
#
# ВАЖНО: сохрани оба файла и пароль в надёжном месте (менеджер паролей, облако). Google Play подписывает приложение
# своим ключом (Play App Signing), а этим ключом подписываются только загрузки: если он потеряется, его можно
# сбросить через поддержку Play Console, но это займёт время.

$ErrorActionPreference = 'Stop'
$here = Split-Path -Parent $MyInvocation.MyCommand.Path
$jks = Join-Path $here 'amber-upload.jks'
$props = Join-Path $here 'keystore.properties'

if (Test-Path $jks) {
    Write-Host "Ключ уже есть: $jks — второй не создаю."
    exit 0
}

$java = if ($env:JAVA_HOME) { $env:JAVA_HOME } else { 'C:\Program Files\Java\jdk-23' }
$keytool = Join-Path $java 'bin\keytool.exe'
if (-not (Test-Path $keytool)) { throw "Не найден keytool: $keytool. Укажи JAVA_HOME." }

$sec = Read-Host 'Пароль для ключа (не короче 6 символов)' -AsSecureString
$pass = [Runtime.InteropServices.Marshal]::PtrToStringAuto([Runtime.InteropServices.Marshal]::SecureStringToBSTR($sec))
if ($pass.Length -lt 6) { throw 'Пароль короче 6 символов' }

& $keytool -genkeypair -v -keystore $jks -storetype PKCS12 -alias amber-upload -keyalg RSA -keysize 2048 -validity 10000 `
    -storepass $pass -keypass $pass -dname 'CN=Amber, O=Amber, C=RU'

@"
storeFile=amber-upload.jks
storePassword=$pass
keyAlias=amber-upload
keyPassword=$pass
"@ | Out-File -FilePath $props -Encoding ascii

Write-Host ''
Write-Host "Готово: $jks и $props"
Write-Host 'Теперь: npm run aab'
