Unicode true
RequestExecutionLevel user
Name "drag"
Caption "drag"
OutFile "${ARTIFACT}"
Icon "${APP_ICON}"
VIProductVersion "${APP_VERSION}.0"
VIAddVersionKey "ProductName" "drag"
VIAddVersionKey "FileDescription" "drag Roadmap Editor"
VIAddVersionKey "FileVersion" "${APP_VERSION}"
VIAddVersionKey "ProductVersion" "${APP_VERSION}"
VIAddVersionKey "LegalCopyright" "See bundled third-party notices"
SetCompressor /SOLID lzma
SilentInstall silent
!include FileFunc.nsh

; Windows callers can quote the full argument or just its path.
!macro Unquote value
  StrCpy $2 ${value} 1
  StrCpy $3 ${value} 1 -1
  StrCmp "$2$3" '""' 0 +2
  StrCpy ${value} ${value} -1 1
!macroend

Section
  InitPluginsDir
  SetOutPath "$PLUGINSDIR\app"
  ClearErrors
  File /r "${PAYLOAD}/*"
  IfErrors failed
  ${GetParameters} $0
  StrCmp $0 "" defaultProfile
  !insertmacro Unquote $0
  StrCpy $1 $0 16
  StrCmp $1 "--user-data-dir=" 0 failed
  StrCpy $1 $0 "" 16
  !insertmacro Unquote $1
  ; Only an existing directory can be passed as an alternate Electron profile.
  StrCmp $1 "" failed
  IfFileExists "$1\." 0 failed
  GetFullPathName $1 "$1\."
  ClearErrors
  ExecWait '"$OUTDIR\drag.exe" "--user-data-dir=$1"' $2
  Goto finished
defaultProfile:
  ClearErrors
  ExecWait '"$OUTDIR\drag.exe"' $2
finished:
  IfErrors failed
  Goto cleanup
failed:
  MessageBox MB_OK|MB_ICONSTOP "drag could not open. Check the profile folder and available disk space."
  StrCpy $2 1
cleanup:
  SetOutPath "$TEMP"
  StrCmp $PLUGINSDIR "" cleanupFailed
  ; Windows can briefly hold the executable after the main process exits.
  StrCpy $3 60
retryCleanup:
  ClearErrors
  RMDir /r "$PLUGINSDIR\app"
  IfErrors 0 cleaned
  IntOp $3 $3 - 1
  StrCmp $3 0 cleanupFailed
  Sleep 500
  Goto retryCleanup
cleanupFailed:
  SetErrorLevel 1
  Goto done
cleaned:
  SetErrorLevel $2
done:
SectionEnd
