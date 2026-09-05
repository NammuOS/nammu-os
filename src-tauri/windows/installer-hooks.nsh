; The local server is a generated, versioned application resource. Remove its
; previous copy before an upgrade so obsolete Next build IDs cannot accumulate.
; User state lives outside $INSTDIR under Tauri's application-data directory.
!macro NSIS_HOOK_PREINSTALL
  RMDir /r "$INSTDIR\resources\local-server"
!macroend

; Also remove any stale generated runtime files during uninstall. This does not
; touch the SQLite database, credential vault, or other user-owned app data.
!macro NSIS_HOOK_PREUNINSTALL
  RMDir /r "$INSTDIR\resources\local-server"
!macroend
