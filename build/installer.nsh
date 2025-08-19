; 自定义 NSIS 片段：使用系统主题的文件夹选择对话框，优先于目录选择页
; 该文件由 electron-builder 的 nsis.include 引入
; 需求：在目录页（Directory Page）前，弹出系统风格的“选择安装目录”对话框；
; - 若用户选择，则将 $INSTDIR 预设为该目录
; - 若用户取消，则保持默认 $INSTDIR，不中断安装流程
; 说明：此对话框基于 nsDialogs::SelectFolderDialog，跟随系统主题，观感更好

!macro preInit
  ; 说明（中文）：
  ; 为避免与 electron-builder 的目录页（允许修改安装路径）重复弹窗，
  ; 这里默认不再在 preInit 中弹出“选择安装目录”的系统对话框。
  ;
  ; 如果未来希望“仅弹系统目录对话框而不显示目录页”，建议：
  ; 1) 在 electron-builder.yml 中将 nsis.allowToChangeInstallationDirectory 设为 false；
  ; 2) 然后在此处恢复下方被注释的对话框代码，以便用户仍可在安装前选择目录。
  ;
  ; 以下为可选的对话框逻辑（默认注释）：
  ; StrCpy $0 "$INSTDIR"
  ; nsDialogs::SelectFolderDialog "选择安装目录" "$0"
  ; Pop $1
  ; StrCmp $1 "" done 0
  ; StrCpy $INSTDIR $1
  ; done:
!macroend

; 在 MUI_LANGUAGE 之前插入页面（使用 customHeader 挂载点以避免顺序警告）
!macro customHeader
  ; 使用产品名（由 electron-builder 注入 ${PRODUCT_NAME}），中文欢迎标题和说明
  !define MUI_WELCOMEPAGE_TITLE "欢迎安装 ${PRODUCT_NAME}"
  !define MUI_WELCOMEPAGE_TEXT "感谢使用 ${PRODUCT_NAME}！\r\n\r\n本向导将引导你完成安装过程。建议关闭正在运行的相关程序，以便更顺利地完成安装。\r\n\r\n版本：${VERSION}    构建时间：__DATE__ __TIME__\r\n\r\n点击‘下一步’继续。"

  ; 许可协议数据（必须在页面插入前定义）
  LicenseData "${BUILD_RESOURCES_DIR}\\EULA.txt"

  ; 插入 Modern UI 欢迎页面与许可页面
  !insertmacro MUI_PAGE_WELCOME
  !insertmacro MUI_PAGE_LICENSE
!macroend

; 保留空的 customInstall 挂载点（不再插入页面，避免与 MUI_LANGUAGE 顺序冲突）
!macro customInstall
!macroend
