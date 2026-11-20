import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, checking, closeOverlay, exec, props, setShared, shared, theme } from "herdr";
import { subscriptionCapacityAvailable } from "./claude-auth.mjs";
import { extraUsageWords } from "./extra-usage.mjs";

const SEGMENTS = 16;

function resetWords(value) {
  if (!value) return "Reset unavailable";
  const delta = value - Date.now();
  if (delta <= 0) return "Resetting now";
  const minutes = Math.ceil(delta / 60000);
  if (minutes < 60) return `Resets in ${minutes}m`;
  const hours = Math.floor(minutes / 60), rest = minutes % 60;
  if (hours < 48) return `Resets in ${hours}h${rest ? ` ${rest}m` : ""}`;
  return `Resets in ${Math.floor(hours / 24)}d ${hours % 24}h`;
}

function usageColor(t, percent) {
  if (percent == null) return t.dim;
  if (percent >= 90) return t.ansi1;
  if (percent >= 70) return t.ansi3;
  return t.ansi2;
}

function meter(t, percent) {
  const filled = percent == null ? 0 : Math.round(SEGMENTS * percent / 100);
  const color = usageColor(t, percent);
  return h_flex().flex_1().min_w(0).gap(3).children(
    Array.from({ length: SEGMENTS }, (_, i) => div().h(7).flex_1().rounded(2).bg(i < filled ? color : t.raised)),
  );
}

function safeAuthMessage(error) {
  const message = String(error?.message ?? error ?? "");
  if (/stale|match|changed|snapshot/i.test(message)) return "Settings changed. Refresh and try again.";
  return "Could not switch Claude billing mode.";
}

export default class AccountUsage extends View {
  init(_props, cx) {
    const cached = shared("account-usage.latest");
    this.results = Array.isArray(cached?.results) ? cached.results : [];
    this.loading = false;
    this.error = null;
    this.updatedAt = cached?.updatedAt || null;
    this.authLoading = new Set();
    this.authMessages = {};
    this.authErrors = {};
    this.expanded = new Set();
    this.handle = cx.focus_handle();
    if (checking()) return;
    this.refresh(cx);
    cx.timer.every(300000, (cx) => this.refresh(cx));
  }

  refresh(cx) {
    if (this.loading) return;
    this.loading = true;
    this.error = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const response = await exec("node", [`${appHome()}/mods/account-usage/usage-helper.mjs`]);
        if (response.code !== 0) throw new Error((response.stderr || response.stdout || `Helper exited ${response.code}`).trim());
        const payload = JSON.parse(response.stdout);
        this.results = Array.isArray(payload.results) ? payload.results : [];
        this.updatedAt = payload.updatedAt || Date.now();
        setShared("account-usage.latest", { updatedAt: this.updatedAt, results: this.results });
      } catch (error) {
        this.error = String(error);
      } finally {
        this.loading = false;
        cx.notify();
      }
    });
  }

  switchAuth(account, targetMode, cx) {
    if (this.authLoading.has(account.id) || !["subscription", "api"].includes(account.authMode) || account.authMode === targetMode) return;
    this.authLoading.add(account.id);
    delete this.authMessages[account.id];
    delete this.authErrors[account.id];
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const response = await exec("node", [`${appHome()}/mods/account-usage/account-control.mjs`, "switch-auth", account.id, targetMode]);
        if (response.code !== 0) throw new Error((response.stderr || response.stdout || `Helper exited ${response.code}`).trim());
        const payload = JSON.parse(response.stdout);
        account.authMode = payload.mode;
        this.authMessages[account.id] = `Switched this profile to ${targetMode === "api" ? "API billing" : "Subscription"}.`;
        setShared("account-usage.latest", { updatedAt: this.updatedAt, results: this.results });
      } catch (error) {
        this.authErrors[account.id] = safeAuthMessage(error);
      } finally {
        this.authLoading.delete(account.id);
        cx.notify();
      }
    });
  }

  subscriptionReady(account) {
    return subscriptionCapacityAvailable(account.authMode, account);
  }

  authSegment(t, account, mode, label) {
    const selected = account.authMode === mode;
    const enabled = !this.authLoading.has(account.id) && ["subscription", "api"].includes(account.authMode) && !selected;
    return div().id(`claude-mode-${account.id}-${mode}`).h(24).px(8).flex().items_center().justify_center().rounded(5).text_size(10).font_medium().cursor_pointer()
      .bg(selected ? t.selected : t.raised).text_color(selected ? t.foreground : enabled ? t.muted : t.dim)
      .when(enabled, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_event, cx) => { cx.stop_propagation(); this.switchAuth(account, mode, cx); }))
      .child(label);
  }

  authToggle(t, account) {
    return h_flex().p(2).gap(2).rounded(7).bg(t.raised).on_mouse_down("left", (_event, cx) => cx.stop_propagation())
      .child(this.authSegment(t, account, "subscription", "Sub"))
      .child(this.authSegment(t, account, "api", "API"));
  }

  row(t, label, window, expanded, detail = null) {
    const percent = window?.usedPercent;
    const extra = [window?.deltaLabel, window?.pace].filter(Boolean).join(" · ");
    return v_flex().gap(2)
      .child(h_flex().h(18).items_center().gap(7)
        .child(div().w(38).flex_none().text_size(10.5).text_color(t.muted).child(label))
        .child(meter(t, percent))
        .child(div().w(34).flex_none().text_right().font_semibold().text_size(10.5).text_color(usageColor(t, percent)).child(`${Math.round(percent)}%`))
        .child(div().w(92).flex_none().truncate().text_right().text_size(9.5).text_color(t.dim).child(detail ?? resetWords(window?.resetsAt))))
      .when(expanded && Boolean(extra), (el) => el.child(div().pl(45).text_size(9.5).text_color(t.dim).child(extra)));
  }

  card(t, account, index) {
    const icon = account.kind === "codex" ? "icons/codex.svg" : "icons/claude.svg";
    const plan = account.plan ? ` · ${account.plan}` : "";
    const hasWindows = Boolean(account.session || account.weekly || account.extra);
    const ready = account.kind === "claude" && this.subscriptionReady(account);
    const expanded = this.expanded.has(account.id);
    return v_flex().id(`account-${index}`).flex_none().p(8).gap(5).rounded(8).border_1().border_color(t.border).bg(t.background)
      .child(h_flex().id(`account-head-${account.id}`).h(28).items_center().gap(7).cursor_pointer().rounded(6).hover((el) => el.bg(t.hover))
        .on_click((_event, cx) => { expanded ? this.expanded.delete(account.id) : this.expanded.add(account.id); cx.notify(); })
        .child(div().size(22).flex_none().rounded(6).bg(t.raised).flex().items_center().justify_center().child(svg(icon).size(14).text_color(t.foreground)))
        .child(v_flex().min_w(0).gap(1)
          .child(div().font_semibold().text_size(11.8).child(account.label))
          .when(Boolean(account.email), (el) => el.child(div().max_w(185).truncate().text_size(9.2).text_color(t.muted).child(account.email))))
        .child(div().text_size(9.5).text_color(t.dim).child(`${account.kind}${plan}`))
        .child(div().flex_1())
        .when(ready, (el) => el.child(h_flex().gap(3).items_center().text_size(9).text_color(t.ansi1)
          .child(div().size(5).rounded_full().bg(t.ansi1)).child("Ready")))
        .when(Boolean(account.stale), (el) => el.child(div().text_size(9).text_color(t.ansi3).child("Cached")))
        .when(account.kind === "claude" && ["subscription", "api"].includes(account.authMode), (el) => el.child(this.authToggle(t, account)))
        .child(div().w(14).text_center().text_size(10).text_color(t.dim).child(expanded ? "▴" : "▾")))
      .when(Boolean(account.error), (el) => el.child(div().px(7).py(5).rounded(6).bg(t.ansi1 + "16").text_color(t.ansi1).text_size(10).child(account.error)))
      .when(!account.error && Boolean(account.session), (el) => el.child(this.row(t, "5h", account.session, expanded)))
      .when(!account.error && Boolean(account.weekly), (el) => el.child(this.row(t, "Week", account.weekly, expanded)))
      .when(!account.error && Boolean(account.extra), (el) => el.child(this.row(t, "Extra", account.extra, expanded, extraUsageWords(account.extra))))
      .when(!account.error && !hasWindows, (el) => el.child(div().text_size(11).text_color(t.dim).child("No usage window available")))
      .when(account.kind === "claude" && Boolean(this.authErrors[account.id] || this.authMessages[account.id]), (el) => el.child(div().text_size(10).text_color(this.authErrors[account.id] ? t.ansi1 : t.done).child(this.authErrors[account.id] || this.authMessages[account.id])));
  }

  render(cx) {
    const t = theme();
    const updated = this.updatedAt ? new Date(this.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
    return v_flex().id("account-usage").track_focus(this.handle).w_full().h(400).min_h(0).bg(t.popover).text_color(t.foreground).text_size(12)
      .on_key_down((event, cx) => {
        if (event.key === "r") { this.refresh(cx); cx.stop_propagation(); }
      })
      .child(h_flex().h(44).flex_none().px(12).items_center().gap(8).border_b(1).border_color(t.border)
        .child(div().font_semibold().text_size(13.5).child("Accounts"))
        .child(div().text_size(10).text_color(t.dim).child("Usage · per-chat accounts"))
        .child(div().flex_1())
        .when(Boolean(updated), (el) => el.child(div().text_size(9.8).text_color(t.dim).child(`Checked ${updated}`)))
        .child(div().id("usage-refresh").size(26).flex_none().rounded(6).flex().items_center().justify_center().cursor_pointer().text_color(this.loading ? t.dim : t.muted).hover((el) => el.bg(t.hover).text_color(t.foreground)).on_click((_event, cx) => this.refresh(cx)).child("↻"))
        .child(div().id("usage-close").size(26).flex_none().rounded(6).flex().items_center().justify_center().cursor_pointer().text_color(t.muted).hover((el) => el.bg(t.hover).text_color(t.foreground)).on_click(() => closeOverlay(props().overlay)).child("×")))
      .child(v_flex().id("usage-list").flex_1().min_h(0).overflow_y_scrollbar().p(10).gap(6)
        .when(this.results.length === 0, (el) => el.child(div().py(40).text_center().text_color(t.dim).child("No cached usage yet")))
        .when(Boolean(this.error), (el) => el.child(div().p(12).rounded(8).bg(t.ansi1 + "16").text_color(t.ansi1).child(this.error)))
        .children(this.results.map((account, index) => this.card(t, account, index))))
      .child(h_flex().h(26).flex_none().px(12).items_center().border_t(1).border_color(t.border).text_size(9.5).text_color(t.dim)
        .child("R refresh · Click an account for pace details · Cmd+Shift+P starts a chat"));
  }
}
