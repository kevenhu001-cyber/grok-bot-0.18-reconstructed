!include "MUI2.nsh"

!ifndef APP_DIR
  !error "APP_DIR define is required"
!endif
!ifndef OUT_FILE
  !error "OUT_FILE define is required"
!endif
!ifndef APP_EXE
  !error "APP_EXE define is required"
!endif

Unicode true
Name "Grok Bot 0.18 Reconstructed"
OutFile "${OUT_FILE}"
InstallDir "$LOCALAPPDATA\Programs\Grok Bot 0.18 Reconstructed"
RequestExecutionLevel user
SetCompressor /SOLID lzma

!define MUI_ABORTWARNING
!define MUI_ICON "${NSISDIR}\Contrib\Graphics\Icons\modern-install.ico"
!define MUI_UNICON "${NSISDIR}\Contrib\Graphics\Icons\modern-uninstall.ico"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH
!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES
!insertmacro MUI_LANGUAGE "English"

Section "Install" SEC_MAIN
  SetShellVarContext current
  SetOutPath "$INSTDIR"
  File /r "${APP_DIR}\*.*"

  WriteUninstaller "$INSTDIR\Uninstall.exe"
  CreateDirectory "$SMPROGRAMS\Grok Bot 0.18 Reconstructed"
  CreateShortcut "$SMPROGRAMS\Grok Bot 0.18 Reconstructed\Grok Bot 0.18 Reconstructed.lnk" "$INSTDIR\${APP_EXE}"
  CreateShortcut "$DESKTOP\Grok Bot 0.18 Reconstructed.lnk" "$INSTDIR\${APP_EXE}"

  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Grok Bot 0.18 Reconstructed" "DisplayName" "Grok Bot 0.18 Reconstructed"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Grok Bot 0.18 Reconstructed" "DisplayVersion" "0.18.0-reconstructed.1"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Grok Bot 0.18 Reconstructed" "Publisher" "Unofficial reconstructed build"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Grok Bot 0.18 Reconstructed" "InstallLocation" "$INSTDIR"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Grok Bot 0.18 Reconstructed" "DisplayIcon" "$INSTDIR\${APP_EXE}"
  WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Grok Bot 0.18 Reconstructed" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Grok Bot 0.18 Reconstructed" "NoModify" 1
  WriteRegDWORD HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Grok Bot 0.18 Reconstructed" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext current
  Delete "$DESKTOP\Grok Bot 0.18 Reconstructed.lnk"
  Delete "$SMPROGRAMS\Grok Bot 0.18 Reconstructed\Grok Bot 0.18 Reconstructed.lnk"
  RMDir "$SMPROGRAMS\Grok Bot 0.18 Reconstructed"
  DeleteRegKey HKCU "Software\Microsoft\Windows\CurrentVersion\Uninstall\Grok Bot 0.18 Reconstructed"
  RMDir /r "$INSTDIR"
SectionEnd
