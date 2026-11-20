# 專案資料格式

`title` 為時間軸檔案的標題，`projects` 為專案陣列。每個專案含 `id`、`name`、`color`、`icon` 與 `phases`；每個任務含 `id`、`label`、`start` 及 `end`。

開啟外部 JSON 時，檔案不得超過 8 MiB，專案數不得超過 2,000；一般新增專案也遵守相同的專案數上限。舊版已存在本機的文件不會因升級被刪除或禁止讀取。任務數較多的檔案仍可開啟與匯出，時間軸顯示會依原有渲染上限提示任務過多。

任務可加上 `"progress": 40` 與 `"status": "進行中"`。兩者可分開填寫。`progress` 為 0 至 100 的數字，0 代表已回報 0%；留白表示尚未回報。讀取舊檔也支援有效的十進位數字字串，讀取時保留原值。`status` 可使用建議值或自訂文字。專案屬性顯示已回報任務的等權平均與回報數；日期、狀態及空白進度不參與推算。專案統計在顯示時產生。

日期使用 `YYYY-MM-DD`，包含結束當日；開始不得晚於結束。`milestone` 可保存里程碑文字，`milestoneDate` 只接受完整日期。`light` 控制淡色，`open_end` 表示結束未定。

`locks` 記錄手動欄位選擇。專案與任務可保存 `fontSize`，圖片共用設定在 `presentation`；未指定字級時自動排版。`presentation.title` 是圖片標題，未設定時沿用檔案 `title`。`presentation.alignMode` 可為 `off`、`today` 或 `date`，指定日期保存在 `alignDate`；切齊只在圖片渲染時建立暫存位置，原始任務與里程碑日期不變。`presentation.dateLineMode` 可為 `off`、`today` 或 `custom`，自訂日期保存在 `dateLineDate`，與切齊獨立。讀寫 JSON 會保留未知欄位，不因切換圖面修改原資料。

個人介面偏好、工作區位置與首次導覽狀態保存在本機，與專案 JSON 分開。設定視窗可另外匯出／匯入偏好檔。`language` 偏好可為 `zh-TW` 或 `en`，預設為 `zh-TW`；它只改介面和新用戶範本的語言，不翻譯或改寫現有專案 JSON、檔名及備份。

本機時間軸檔案庫使用 IndexedDB，文件識別碼、檔名與檢視資料保存在模型外。每次修改先保存包含文件識別碼的同步草稿，再寫入檔案庫；切換前先完成目前檔案寫入。儲存空間不足會拒絕變更或切換，其他文件保留。舊版單一草稿自動成為第一份文件，未知欄位、識別碼與手動鎖定保持原樣。

版本備份依文件隔離；舊版未分文件的備份只顯示在移轉後的原始文件。瀏覽器版本備份使用 IndexedDB。桌面版本備份位於 macOS 的 `~/Library/Application Support/drag-roadmap/backups/` 或 Windows 的 `%APPDATA%\drag-roadmap\backups\`，可透過設定檢視與還原；程式結束時會寫完最新待存版本。瀏覽器關閉時的非同步版本備份不保證完成，即時草稿仍由每次修改保存。
