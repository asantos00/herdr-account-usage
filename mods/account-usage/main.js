import { View, div, svg } from "gpui-kit";
import { h_flex, v_flex } from "gpui-base";
import { appHome, closeOverlay, exec, home, props, readTextFile, setShared, shared, theme, writeTextFile } from "herdr";
import { SETTINGS_RELATIVE_PATH, inspectAuthMode, serializeSettings, subscriptionCapacityAvailable, switchAuthMode } from "./claude-auth.mjs";

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
    this.authPath = `${home()}/${SETTINGS_RELATIVE_PATH}`;
    this.authMode = shared("claude-auth.mode") || "invalid";
    this.authLoading = false;
    this.authMessage = null;
    this.authError = null;
    this.handle = cx.focus_handle();
    if (!this.updatedAt || Date.now() - this.updatedAt >= 300000) this.refresh(cx);
    this.refreshAuth(cx);
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

  refreshAuth(cx) {
    if (this.authLoading) return;
    this.authLoading = true;
    this.authError = null;
    cx.spawn(async (cx) => {
      try {
        const text = await readTextFile(this.authPath);
        if (text == null) throw new Error("missing");
        this.authMode = inspectAuthMode(JSON.parse(text)).mode;
        setShared("claude-auth.mode", this.authMode);
      } catch (_error) {
        this.authMode = "invalid";
        this.authError = "Could not read Claude settings.";
      } finally {
        this.authLoading = false;
        cx.notify();
      }
    });
  }

  switchAuth(targetMode, cx) {
    if (this.authLoading || !["subscription", "api"].includes(this.authMode) || this.authMode === targetMode) return;
    this.authLoading = true;
    this.authMessage = null;
    this.authError = null;
    cx.notify();
    cx.spawn(async (cx) => {
      try {
        const original = await readTextFile(this.authPath);
        if (original == null) throw new Error("missing");
        const result = switchAuthMode(JSON.parse(original), targetMode);
        if (result.changed) await writeTextFile(this.authPath, serializeSettings(result.settings, original), original);
        this.authMode = result.inspection.mode;
        setShared("claude-auth.mode", this.authMode);
        this.authMessage = `Switched to ${targetMode === "api" ? "API billing" : "Subscription"}.`;
      } catch (error) {
        this.authError = safeAuthMessage(error);
      } finally {
        this.authLoading = false;
        cx.notify();
      }
    });
  }

  subscriptionReady(account) {
    return subscriptionCapacityAvailable(this.authMode, account);
  }

  authSegment(t, mode, label) {
    const selected = this.authMode === mode;
    const enabled = !this.authLoading && ["subscription", "api"].includes(this.authMode) && !selected;
    return div().id(`claude-mode-${mode}`).h(24).px(8).flex().items_center().justify_center().rounded(5).text_size(10).font_medium().cursor_pointer()
      .bg(selected ? t.selected : t.raised).text_color(selected ? t.foreground : enabled ? t.muted : t.dim)
      .when(enabled, (el) => el.hover((s) => s.bg(t.hover).text_color(t.foreground)).on_click((_event, cx) => this.switchAuth(mode, cx)))
      .child(label);
  }

  authToggle(t) {
    return h_flex().p(2).gap(2).rounded(7).bg(t.raised)
      .child(this.authSegment(t, "subscription", "Sub"))
      .child(this.authSegment(t, "api", "API"));
  }

  row(t, label, window) {
    const percent = window?.usedPercent;
    // Vs-last-period and pace, once there's enough recorded history to say
    // either honestly (see usage-pace.mjs): how this compares to the same
    // point last cycle, and whether today's rate will last until reset.
    const extra = [window?.deltaLabel, window?.pace].filter(Boolean).join(" · ");
    return v_flex().gap(4)
      .child(h_flex().items_center().gap(9)
        .child(div().w(48).flex_none().text_size(11).text_color(t.muted).child(label))
        .child(meter(t, percent))
        .child(div().w(38).flex_none().text_right().font_semibold().text_size(11.5).text_color(usageColor(t, percent)).child(`${Math.round(percent)}%`)))
      .child(div().pl(57).text_size(10).text_color(t.dim).child(resetWords(window?.resetsAt)))
      .when(Boolean(extra), (el) => el.child(div().pl(57).text_size(10).text_color(t.dim).child(extra)));
  }

  card(t, account, index) {
    const icon = account.kind === "codex" ? "icons/codex.svg" : "icons/claude.svg";
    const plan = account.plan ? ` · ${account.plan}` : "";
    const hasWindows = Boolean(account.session || account.weekly);
    const ready = account.kind === "claude" && this.subscriptionReady(account);
    return v_flex().id(`account-${index}`).flex_none().p(10).gap(8).rounded(8).border_1().border_color(t.border).bg(t.background)
      .child(h_flex().items_center().gap(8)
        .child(div().size(24).flex_none().rounded(6).bg(t.raised).flex().items_center().justify_center().child(svg(icon).size(15).text_color(t.foreground)))
        .child(div().font_semibold().text_size(12.5).child(account.label))
        .child(div().text_size(10).text_color(t.dim).child(`${account.kind}${plan}`))
        .child(div().flex_1())
        .when(ready, (el) => el.child(h_flex().gap(4).items_center().text_size(9.5).text_color(t.ansi1)
          .child(div().size(5).rounded_full().bg(t.ansi1)).child("Subscription ready")))
        .when(Boolean(account.stale), (el) => el.child(div().text_size(9.5).text_color(t.ansi3).child("Cached")))
        .when(account.kind === "claude", (el) => el.child(this.authToggle(t))))
      .when(Boolean(account.error), (el) => el.child(div().px(8).py(7).rounded(6).bg(t.ansi1 + "16").text_color(t.ansi1).text_size(11).child(account.error)))
      .when(!account.error && Boolean(account.session), (el) => el.child(this.row(t, "Session", account.session)))
      .when(!account.error && Boolean(account.weekly), (el) => el.child(this.row(t, "Week", account.weekly)))
      .when(!account.error && !hasWindows, (el) => el.child(div().text_size(11).text_color(t.dim).child("No usage window available")))
      .when(account.kind === "claude" && Boolean(this.authError || this.authMessage), (el) => el.child(div().text_size(10).text_color(this.authError ? t.ansi1 : t.done).child(this.authError || this.authMessage)));
  }

  render(cx) {
    const t = theme();
    const updated = this.updatedAt ? new Date(this.updatedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" }) : null;
    return v_flex().id("account-usage").track_focus(this.handle).w_full().h(400).min_h(0).bg(t.popover).text_color(t.foreground).text_size(12)
      .on_key_down((event, cx) => {
        if (event.key === "r") { this.refresh(cx); this.refreshAuth(cx); cx.stop_propagation(); }
      })
      .child(h_flex().h(44).flex_none().px(12).items_center().gap(8).border_b(1).border_color(t.border)
        .child(div().font_semibold().text_size(13.5).child("Accounts"))
        .child(div().text_size(10).text_color(t.dim).child("Usage · billing"))
        .child(div().flex_1())
        .when(Boolean(updated), (el) => el.child(div().text_size(9.8).text_color(t.dim).child(`Checked ${updated}`)))
        .child(div().id("usage-refresh").size(26).flex_none().rounded(6).flex().items_center().justify_center().cursor_pointer().text_color(this.loading ? t.dim : t.muted).hover((el) => el.bg(t.hover).text_color(t.foreground)).on_click((_event, cx) => { this.refresh(cx); this.refreshAuth(cx); }).child("↻"))
        .child(div().id("usage-close").size(26).flex_none().rounded(6).flex().items_center().justify_center().cursor_pointer().text_color(t.muted).hover((el) => el.bg(t.hover).text_color(t.foreground)).on_click(() => closeOverlay(props().overlay)).child("×")))
      .child(v_flex().id("usage-list").flex_1().min_h(0).overflow_y_scrollbar().p(12).gap(8)
        .when(this.results.length === 0, (el) => el.child(div().py(40).text_center().text_color(t.dim).child("No cached usage yet")))
        .when(Boolean(this.error), (el) => el.child(div().p(12).rounded(8).bg(t.ansi1 + "16").text_color(t.ansi1).child(this.error)))
        .children(this.results.map((account, index) => this.card(t, account, index))))
      .child(h_flex().h(26).flex_none().px(12).items_center().border_t(1).border_color(t.border).text_size(9.5).text_color(t.dim)
        .child("R refresh · billing changes apply to new Claude sessions"));
  }
}
