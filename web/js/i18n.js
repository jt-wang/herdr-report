// The page's words in Chinese and English. The phone's language picks one,
// unless the reader chose one in settings.

export const STR = {
  zh: {
    appTitle: "会话进度",
    ago_now: "刚刚", ago_min: "{n} 分钟前", ago_hour: "{n} 小时前", ago_yesterday: "昨天", ago_days: "{n} 天前",
    ptrPull: "下拉刷新", ptrRelease: "松开刷新", ptrLoading: "正在刷新…", ptrDone: "已更新 {time}", ptrFail: "刷新失败",
    needs: "需要你", blocked: "卡住", doing: "进行中", todo: "待做", done: "已完成",
    needsEmpty: "没有等你处理的事", needsEmptySub: "所有会话都在自己往前走。", blockedEmpty: "没有卡住的事",
    doingEmpty: "没有进行中的事", todoEmpty: "没有待做的事", doneEmpty: "还没有完成的事",
    status_working: "工作中", status_blocked: "等你确认", status_done: "刚做完", status_idle: "空闲", statusUnknown: "状态未知",
    waiting: "停在确认或提问的界面，等你回应",
    customCommand: "自定义命令",
    summarizedAt: "总结于 {time}",
    focus: "在 Mac 上切过去", focused: "已在 Mac 上切到这个窗格", focusFailed: "切换失败：{e}",
    nowPrefix: "现在：{x}", seeAll: "看这个会话的全部进度", showAll: "显示全部 {n} 条", back: "返回",
    offTitle: "总结没开", offBody: "现在只有 Herdr 看到的状态和每个 agent 的最后一句话。",
    offRec: "推荐用 {label} 写总结，每次约 ${cost}。",
    offHowRec: "在 Herdr 里运行插件的「Use the recommended summarizer」。", offHow: "在插件的 config.env 里设 SUMMARIZER。",
    loadFailed: "读取失败", reconnecting: "重连中…", loading: "加载中…", notifySettings: "通知设置",
    foot: "{n} 个会话，{k} 个有总结。蓝色数字是等你处理的事。点工作区名字可以收起。只读，不会给任何窗格发输入。",
    sessionsCount: "{n} 个会话，{k} 件",
    src_self: "agent 自己汇报", src_transcript: "根据对话记录总结", src_screen: "根据终端最近的屏幕总结", by: "{src}，由 {who} 写",
    lastWords: "最后说", writing: "正在写总结…", notYet: "{status} · 总结还没写好", updateFailed: "最近一次更新失败：{e}",
    noOutput: "没有输出", readFailed: "读取失败：{e}", terminal: "终端最后的输出 ›",
    selfReport: "现在、需要你、卡住、进行中这几项是 agent 自己在 {time} 汇报的", paneClosed: "这个窗格已经关了",
    noPermission: "没有得到通知权限。", error: "出错了：{e}",
    addToHome: "先加到主屏幕", addToHomeWhy: "iPhone 只给主屏幕上的网页发通知。",
    step1: "点 Safari 下方的分享按钮", step2: "选「添加到主屏幕」", step3: "从主屏幕打开，再回到这一页",
    notifications: "通知", unsupported: "这个浏览器收不到网页通知。", denied: "通知被关掉了，在系统设置里给这个网页打开通知。",
    onHere: "这台设备会收到", offHere: "在这台设备上收通知", needsSub: "包括 agent 停在确认界面等你",
    quiet: "安静时段", quietSub: "这段时间只发「需要你」", from: "从", to: "到",
    sent: "已发出，几秒内会收到。", notSent: "没有发出去，看一下 Mac 上的日志。", sendTest: "发一条测试",
    summaries: "总结", off: "没开", devices: "{n} 台设备会收到通知。",
    modeContinuous: "总结一直在更新，不管有没有人看。", modeOnDemand: "总结只在有人打开页面时更新，没人看不花钱。",
    changeModel: "用哪个模型，在 Mac 上用插件的 summarizer 操作查看和更改。",
    language: "语言", langAuto: "跟随系统", langZh: "中文", langEn: "English",
  },
  en: {
    appTitle: "Sessions",
    ago_now: "just now", ago_min: "{n} min ago", ago_hour: "{n} h ago", ago_yesterday: "yesterday", ago_days: "{n} days ago",
    ptrPull: "Pull to refresh", ptrRelease: "Release to refresh", ptrLoading: "Refreshing…", ptrDone: "Updated {time}", ptrFail: "Couldn't refresh",
    needs: "Needs you", blocked: "Stuck", doing: "In progress", todo: "To do", done: "Done",
    needsEmpty: "Nothing needs you", needsEmptySub: "Every session is moving on its own.", blockedEmpty: "Nothing is stuck",
    doingEmpty: "Nothing in progress", todoEmpty: "Nothing to do", doneEmpty: "Nothing done yet",
    status_working: "Working", status_blocked: "Waiting for you", status_done: "Just finished", status_idle: "Idle", statusUnknown: "Status unknown",
    waiting: "Stopped at a prompt, waiting for you",
    customCommand: "custom command",
    summarizedAt: "summarized {time}",
    focus: "Show on the Mac", focused: "Showing it on the Mac", focusFailed: "Couldn't switch: {e}",
    nowPrefix: "Now: {x}", seeAll: "See the whole session", showAll: "Show all {n}", back: "Back",
    offTitle: "Summaries are off", offBody: "You see Herdr's status and each agent's last words.",
    offRec: "Suggested: {label}, about ${cost} per summary.",
    offHowRec: "In Herdr, run the plugin's \"Use the recommended summarizer\".", offHow: "Set SUMMARIZER in the plugin's config.env.",
    loadFailed: "Can't load", reconnecting: "Reconnecting…", loading: "Loading…", notifySettings: "Notification settings",
    foot: "{n} sessions, {k} summarized. Blue numbers are things waiting for you. Tap a workspace to fold it. Read-only: nothing is ever typed into a pane.",
    sessionsCount: "{n} sessions, {k} items",
    src_self: "the agent's own report", src_transcript: "Summarized from its record", src_screen: "Summarized from its screen", by: "{src} by {who}",
    lastWords: "Last words", writing: "Writing a summary…", notYet: "{status} · no summary yet", updateFailed: "Last update failed: {e}",
    noOutput: "No output", readFailed: "Couldn't read: {e}", terminal: "Terminal output ›",
    selfReport: "Now, needs you, stuck and in progress come from the agent's own report at {time}", paneClosed: "This pane has closed",
    noPermission: "Notifications weren't allowed.", error: "Something went wrong: {e}",
    addToHome: "Add to Home Screen first", addToHomeWhy: "iPhone only sends notifications to web apps on the Home Screen.",
    step1: "Tap Share in Safari", step2: "Choose \"Add to Home Screen\"", step3: "Open it from the Home Screen and come back here",
    notifications: "Notifications", unsupported: "This browser can't receive web notifications.", denied: "Notifications are blocked. Allow them for this page in Settings.",
    onHere: "This device gets them", offHere: "Get them on this device", needsSub: "Including an agent stopped at a prompt",
    quiet: "Quiet hours", quietSub: "Only \"Needs you\" during these hours", from: "From", to: "To",
    sent: "Sent. It should arrive in a few seconds.", notSent: "Not sent. Check the log on the Mac.", sendTest: "Send a test",
    summaries: "Summaries", off: "Off", devices: "Devices getting notifications: {n}",
    modeContinuous: "Summaries update all the time, whether or not anyone is looking.",
    modeOnDemand: "Summaries only update while someone has the page open, so nothing is spent otherwise.",
    changeModel: "Which model writes them is shown and changed on the Mac with the plugin's summarizer action.",
    language: "Language", langAuto: "Automatic", langZh: "中文", langEn: "English",
  },
};

const KEY = "pm.lang";

// saved: "zh" | "en" | "auto" | null; device: navigator.language
export function pickLang({ saved, device }) {
  if (saved === "zh" || saved === "en") return saved;
  return /^zh/i.test(device || "") ? "zh" : "en";
}

function saved() {
  try { return localStorage.getItem(KEY); } catch { return null; }
}

let lang = pickLang({ saved: typeof localStorage === "undefined" ? null : saved(), device: globalThis.navigator?.language });

export const getLang = () => lang;
export const savedLang = () => (typeof localStorage === "undefined" ? null : saved()) || "auto";
export function setLang(l) { lang = l; }
export function chooseLang(choice) {
  try { localStorage.setItem(KEY, choice); } catch {}
  lang = pickLang({ saved: choice, device: globalThis.navigator?.language });
}

export function t(key, vars = {}) {
  const s = STR[lang][key] ?? STR.en[key] ?? key;
  return s.replace(/\{(\w+)\}/g, (_, k) => (vars[k] != null ? String(vars[k]) : ""));
}
