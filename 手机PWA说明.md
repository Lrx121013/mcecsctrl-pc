# 手机端 PWA（最简便版）

PWA = 一个"能装到手机主屏幕"的网页控制台。手机浏览器打开 → 「添加到主屏幕」→ 图标应用，全屏打开，跟原生 App 差不多。

## 它连什么
PWA 只是**界面**，真正干活的是一个**后端**（填在页面顶部"API 后端"框里，存手机本地）。
最省事的搭配：**把桌面版那套 `ecs-console` 传到 阿里云 函数计算 FC**（就是你"办法二"的中继函数），
把 FC 的 **HTTP 触发器地址** 填进 PWA 的"API 后端"。这样手机随时（含学校）都能控 ECS。
- 阿里云 FC 会做原始 TCP（RCON/MC/探活/MCS 23333 都能跑，因为 FC 是服务端）→ PWA 全功能。
- 学校外网连不上 Cloudflare 时，改 A 记录那步自动跳过+提示，不影响其它。

## 上线（GitHub Pages，免费 + HTTPS，可安装 PWA）
1. 桌面源码传到 GitHub（含 `.github` 工作流）。
2. 把 `pwa/` 里的文件（index.html / manifest.webmanifest / sw.js / icon-192.png / icon-512.png）
   放到仓库的 **根目录**（或一个 `pwa` 子目录也行，Pages 指向它）。
3. 仓库 **Settings → Pages → Source = 主分支 / (根目录或 pwa 文件夹)** → 保存。
   得到 `https://你的用户名.github.io/仓库名/`（自动 HTTPS）。
4. 手机（最好安卓）用浏览器打开该地址 → 浏览器菜单 → **添加到主屏幕 / 安装应用** → 出图标。
   打开后在顶部"API 后端"框填 **阿里云 FC 触发器地址** → 保存 → 登录密码 → 用。

> 提示：PWA 要 HTTPS 才能安装（GitHub Pages 就是 HTTPS，OK）。
> 若 FC 在 cn-hongkong/某地域，PWA 跨域调用它：确保 FC 触发器开了 **CORS（允许 * 跨域）**，
> 否则浏览器会被 CORS 拦（桌面版无此问题，因它是原生不是浏览器）。

## 限制（老实说）
- PWA 的"原始 TCP"其实是**后端(FC)做的**，不是手机做的 → 手机本身不用开端口。
- GitHub Pages 在国内学校**有时不稳/慢**（取决于学校对 GitHub 的网络）；不稳就改用别的免费静态托管
  （腾讯云 COS 静态、或阿里云 OSS 静态）放同一套 PWA 文件，照样装。
