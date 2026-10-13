# AiReach target

这是 AutoTestLoop 的一个项目接入示例，不是框架本身。

这里只保存 AiReach 的回归场景和接口清单。执行引擎在仓库根目录。

默认地址：

- Web: `WEB_URL`，未设置时为 `http://127.0.0.1:5173`
- BFF: `BFF_URL`，未设置时为 `http://127.0.0.1:3101`

账号只能来自本地环境变量：`TEST_EMAIL` / `TEST_PASSWORD`，或 `TEST_PHONE` / `TEST_OTP`。仓库里没有默认账号。短信接口还需要显式设置 `TEST_AUTH_ENV`。
