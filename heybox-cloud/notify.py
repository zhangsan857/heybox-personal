import json
import os
import re
from datetime import datetime
from pathlib import Path
from email.headerregistry import Address
from email.message import EmailMessage
from email.utils import format_datetime, make_msgid
from mail_support import BEIJING, MailConfig, read_config, send_notice, safe_error

IDS = ("sign", "1", "19", "31")
NAMES = {"sign": "签到", "1": "分享帖子", "19": "分享游戏", "31": "分享游戏评价"}
MARKERS = {"CLOUD_CHECK_OK", "CLOUD_RUN_VERIFIED", "CLOUD_RUN_SKIPPED", "CLOUD_FAILURE_DRILL", "CLOUD_TASK_FAILED"}


def context(env):
    if env.get("GITHUB_REPOSITORY") != "zhangsan857/heybox-personal" or env.get("GITHUB_REF") != "refs/heads/main" or env.get("GITHUB_EVENT_NAME") != "workflow_dispatch":
        raise ValueError("CLOUD_NOTICE_CONTEXT_DENIED")
    run_id, attempt = str(env.get("GITHUB_RUN_ID", "")), str(env.get("GITHUB_RUN_ATTEMPT", ""))
    if not re.fullmatch(r"[1-9][0-9]{0,23}", run_id) or not re.fullmatch(r"[1-9][0-9]{0,5}", attempt):
        raise ValueError("CLOUD_NOTICE_CONTEXT_DENIED")
    mode = env.get("CLOUD_MODE", "unknown")
    if mode not in {"check", "run", "failure-drill"}:
        raise ValueError("CLOUD_NOTICE_CONTEXT_DENIED")
    return {"mode": mode, "runId": run_id, "attempt": attempt, "id": run_id + "." + attempt,
            "url": f"https://github.com/zhangsan857/heybox-personal/actions/runs/{run_id}"}


def fallback(ctx, code):
    return {"ok": False, "mode": ctx["mode"], "simulated": False, "marker": "CLOUD_TASK_FAILED", "error": code,
            "mutations": dict.fromkeys(IDS, 0), "executed": [], "skipped": []}


def read_result(env, ctx):
    try:
        if any(env.get(key) != "success" for key in ("CHECKOUT_OUTCOME", "NODE_OUTCOME", "VERIFY_OUTCOME")):
            return fallback(ctx, "CLOUD_SETUP_FAILED")
        if not env.get("RUNNER_TEMP"):
            return fallback(ctx, "CLOUD_RESULT_MISSING")
        file = Path(env["RUNNER_TEMP"]) / "heybox-cloud-result.json"
        if not file.is_file():
            return fallback(ctx, "CLOUD_RESULT_MISSING")
        if file.stat().st_size > 65_536:
            raise ValueError()
        value = json.loads(file.read_text(encoding="utf-8"))
        if value.get("schema") != 1 or value.get("runId") != ctx["runId"] or value.get("attempt") != ctx["attempt"] or value.get("mode") != ctx["mode"]:
            raise ValueError()
        if type(value.get("ok")) is not bool or type(value.get("simulated")) is not bool or value.get("marker") not in MARKERS:
            raise ValueError()
        if not re.fullmatch(r"\d{4}-\d{2}-\d{2}", value.get("day", "")):
            raise ValueError()
        mutations = {key: value.get("mutations", {}).get(key) for key in IDS}
        if any(type(number) is not int or not 0 <= number <= 50 for number in mutations.values()):
            raise ValueError()
        for key in ("executed", "skipped"):
            items = value.get(key)
            if not isinstance(items, list) or any(item not in IDS for item in items) or len(items) != len(set(items)):
                raise ValueError()
        if set(value["executed"]) & set(value["skipped"]):
            raise ValueError()
        result = {key: value[key] for key in ("ok", "mode", "simulated", "marker", "day", "executed", "skipped")}
        result["mutations"] = mutations
        if value["simulated"]:
            if ctx["mode"] != "failure-drill" or value["ok"] or value["marker"] != "CLOUD_FAILURE_DRILL" or any(mutations.values()):
                raise ValueError()
        if value["ok"]:
            if env.get("TASK_OUTCOME") != "success" or value["simulated"]:
                return fallback(ctx, "CLOUD_STEP_NOT_SUCCESS")
            states = {key: value.get("states", {}).get(key) for key in IDS}
            if any(state not in {"finish", "waiting"} for state in states.values()):
                raise ValueError()
            if ctx["mode"] == "check" and (value["marker"] != "CLOUD_CHECK_OK" or any(mutations.values()) or value["executed"]):
                raise ValueError()
            if ctx["mode"] == "run":
                if any(state != "finish" for state in states.values()) or set(value["executed"] + value["skipped"]) != set(IDS):
                    raise ValueError()
                if any(mutations[key] <= 0 for key in value["executed"]):
                    raise ValueError()
                if value["marker"] == "CLOUD_RUN_SKIPPED" and (value["executed"] or any(mutations.values())):
                    raise ValueError()
                if value["marker"] not in {"CLOUD_RUN_SKIPPED", "CLOUD_RUN_VERIFIED"}:
                    raise ValueError()
                if value["marker"] == "CLOUD_RUN_VERIFIED" and not value["executed"]:
                    raise ValueError()
            result["states"] = states
        else:
            error = value.get("error", "")
            if not re.fullmatch(r"(?:CLOUD_[A-Z0-9_]{1,80}|APP_AUTH_EXPIRED|UPSTREAM_RATE_LIMIT|UPSTREAM_CAPTCHA_REQUIRED|SIGN_NOT_VERIFIED|SHARE_NOT_SETTLED|TASK_SCHEMA_CHANGED|ACCOUNT_READBACK_MISMATCH|REQUEST_NOT_CONFIRMED(?::[a-z0-9_]{1,32}){0,3})", error):
                raise ValueError()
            result["error"] = error
        return result
    except Exception:
        return fallback(ctx, "CLOUD_RESULT_INVALID")


def compose(config, ctx, result, now=None):
    current = (now or datetime.now(BEIJING)).astimezone(BEIJING)
    kind = "云端演练" if result["simulated"] else "云端只读" if ctx["mode"] == "check" else "云端任务"
    outcome = "成功" if result["ok"] else "模拟失败" if result["simulated"] else "失败"
    message = EmailMessage()
    message["From"] = Address("小黑盒个人通知", addr_spec=config.user)
    message["To"] = Address(addr_spec=config.recipient)
    message["Subject"] = f"[小黑盒][{kind}][{outcome}] 编号 {ctx['id']}"
    message["Date"] = format_datetime(current)
    message["Message-ID"] = make_msgid(domain="heybox-personal.invalid")
    total = sum(result["mutations"].values())
    lines = [f"北京时间：{current.strftime('%Y-%m-%d %H:%M:%S')} +08:00", f"运行编号：{ctx['id']}",
             f"模式：{ctx['mode']}", f"结果标记：{result['marker']}", f"业务请求尝试次数：{total}", ""]
    if result["ok"]:
        if ctx["mode"] == "check":
            lines.append("真实账号只读核验成功，本轮没有提交签到或分享任务。")
        elif result["marker"] == "CLOUD_RUN_SKIPPED":
            lines.append("四项在执行时均已完成，本轮全部跳过，尚未新增云端提交证明。")
        else:
            lines.append("本轮任务结束后已独立读回服务端状态。")
            lines.append("本轮提交并核验：" + "，".join(NAMES[key] for key in result["executed"]))
            lines.append("本轮已完成跳过：" + ("，".join(NAMES[key] for key in result["skipped"]) or "无"))
        for key in IDS:
            lines.append(NAMES[key] + "：" + ("已完成" if result["states"][key] == "finish" else "待完成"))
    elif result["simulated"]:
        lines.extend(["本轮为预设失败演练，没有连接小黑盒，也没有读取或更改真实登录配置。",
                      "模拟错误：APP_AUTH_EXPIRED", "演练任务最终显示红色属于预期，用于验证失败后的邮件与失败状态联动。"])
    else:
        lines.extend(["本轮未通过，任务链已停止。", "错误代码：" + result["error"],
                      "已发出的请求仍可能生效，请先以check模式只读核对，避免连续重报。"])
        if result["error"] == "APP_AUTH_EXPIRED":
            lines.append("在本机重新授权并只读核验后，更新GitHub的HEYBOX_CONFIG_B64 Secret，再用check模式确认恢复。")
        if result["error"] == "CLOUD_SETUP_FAILED":
            lines.append("请查看运行链接中检出代码、设置Node或校验上传包的首次失败步骤。")
    lines.extend(["", "运行记录：", ctx["url"], "", "本阶段仍为手动运行，正式15:00定时尚未启用。"])
    message.set_content("\n".join(lines))
    return message


def main(environ=None, smtp_factory=None, emit=print, now=None):
    env = os.environ if environ is None else environ
    try:
        ctx = context(env)
        result = read_result(env, ctx)
        config = read_config(env)
        message = compose(config, ctx, result, now)
        send_notice(config, message, smtp_factory)
        emit("MAIL_SMTP_ACCEPTED")
        emit("CLOUD_NOTICE_MARKER=" + result["marker"])
        emit("CLOUD_NOTICE_ID=" + ctx["id"])
        if env.get("GITHUB_OUTPUT"):
            with open(env["GITHUB_OUTPUT"], "a", encoding="utf-8") as output:
                output.write("task_ok=" + str(result["ok"]).lower() + "\n")
        return 0
    except Exception as error:
        emit("MAIL_TEST_ERROR=" + safe_error(error))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
