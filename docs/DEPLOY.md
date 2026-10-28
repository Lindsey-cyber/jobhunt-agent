# 部署到 VPS

目标：VPS 每天早上（纽约时间约 7:23）自动跑一遍总管：Gmail 提醒 → 多渠道发现 → 筛选 → 独立审计 → 报告，结果提交回 GitHub；Dashboard 只在 VPS 本机 127.0.0.1 上，通过 SSH 隧道看。系统是 Ubuntu 22.04/24.04 或 Debian 12，1 核 2 GB 内存够用。

## 1. 让 VPS 能读写这个私有仓库

在 VPS 上（root）：

```bash
ssh-keygen -t ed25519 -N "" -f /root/.ssh/jobhunt_deploy -C jobhunt-vps
```

```bash
cat /root/.ssh/jobhunt_deploy.pub
```

把打印出来的公钥加到 GitHub：仓库 Lindsey-cyber/jobhunt-agent → Settings → Deploy keys → Add deploy key，**勾选 Allow write access**（VPS 每天要把报告推回来）。

## 2. 拉代码并安装

```bash
GIT_SSH_COMMAND="ssh -i /root/.ssh/jobhunt_deploy -o StrictHostKeyChecking=accept-new" git clone -b v2 git@github.com:Lindsey-cyber/jobhunt-agent.git /opt/jobhunt-agent
```

```bash
sudo bash /opt/jobhunt-agent/deploy/install.sh
```

脚本会装 Node 22、Chromium 及依赖，建 `jobhunt` 用户，装好每日定时任务和 Dashboard 服务，最后跑一遍 `npm run check`。重复运行是安全的。

## 3. 放密钥（不进仓库）

Anthropic API key 写进 `/etc/jobhunt/env`：

```bash
sudo nano /etc/jobhunt/env
```

把 `ANTHROPIC_API_KEY=` 补上。账户里要有余额（Console → Plans & Billing），否则审核 agent 调用会被拒绝。

Gmail OAuth 客户端 JSON 放到 jobhunt 用户目录（文件从你电脑传上去，例如 `scp client_secret_*.json root@VPS:/tmp/gmail-client.json`）：

```bash
sudo install -m 600 -o jobhunt -g jobhunt /tmp/gmail-client.json /home/jobhunt/.config/jobhunt/gmail-client.json && rm /tmp/gmail-client.json
```

授权只读 Gmail（两步，第一步打印链接）：

```bash
sudo -u jobhunt bash -c 'cd /opt/jobhunt-agent && npm run -s jh -- gmail auth'
```

在你自己的浏览器打开链接、登录 lm3879@columbia.edu、允许只读访问。浏览器最后会跳到一个打不开的 `http://localhost:8765/?...` 页面，复制地址栏完整地址，然后：

```bash
sudo -u jobhunt bash -c "cd /opt/jobhunt-agent && npm run -s jh -- gmail auth --code '粘贴的地址'"
```

Google Cloud 里这个 OAuth 应用如果还是 Testing 状态，令牌 7 天后过期；改成 In production 就不会。

## 4. 第一次手动跑

```bash
sudo systemctl start jobhunt-daily.service
```

```bash
journalctl -u jobhunt-daily -f
```

## 5. 看 Dashboard

在你自己的电脑上开隧道：

```bash
ssh -L 8787:127.0.0.1:8787 root@你的VPS地址
```

然后浏览器打开 http://127.0.0.1:8787 （Dashboard），http://127.0.0.1:8787/pending （每日清单），http://127.0.0.1:8787/REPORT.md （报告）。

## 日常

- 每日清单：`sudo -u jobhunt bash -c 'cd /opt/jobhunt-agent && npm run -s jh -- pending'`，或看 `/pending`。
- 批准/驳回：`jh label <id> fit|not_fit`，回答问题：`jh answer <id> <回答>`。这些也可以在云端会话里做，VPS 下一次运行前会 `git pull`。
- 定时任务状态：`systemctl list-timers jobhunt-daily.timer`；日志：`journalctl -u jobhunt-daily --since today`。
- `npm run check` 不通过时当天不运行发现，日志里有原因。
