import { View, div, svg } from "gpui-kit";
import { h_flex } from "gpui-base";
import { agents, appHome, checking, exec, keys, run, setShared, shared, spaces, theme, window } from "herdr";
import { compactUsageMetaLabel, mostUrgentUsage } from "./usage-summary.mjs";

const PROVIDER_COLORS = Object.freeze({ codex: "#59C18C", claude: "#F59E75" });

export default class WorkspaceStatus extends View {
  init(_props, cx) {
    this.usageLoading = false;
    if (checking()) return;
    this.refreshUsage(cx);
    cx.timer.every(300000, (cx) => this.refreshUsage(cx));
  }

  refreshUsage(cx) {
    const latest = shared("account-usage.latest");
    const missingColors = Array.isArray(latest?.results) && latest.results.some((account) => !account.color);
    if (this.usageLoading || (!missingColors && latest?.updatedAt && Date.now() - latest.updatedAt < 300000)) return;
    this.usageLoading = true;
    cx.spawn(async (cx) => {
      try {
        const response = await exec("node", [`${appHome()}/mods/account-usage/usage-helper.mjs`]);
        if (response.code !== 0) return;
        const payload = JSON.parse(response.stdout);
        if (Array.isArray(payload.results)) setShared("account-usage.latest", { updatedAt: payload.updatedAt || Date.now(), results: payload.results });
      } catch (_error) {
        // Keep the last successful cache silently; the status bar must stay passive.
      } finally {
        this.usageLoading = false;
        cx.notify();
      }
    });
  }

  // The palette key as actually bound, not a hardcoded one; without a
  // binding the hint stays useful ("commands") instead of lying.
  hint(t) {
    const mac = window()?.platform === "macos";
    const mod = { cmd: mac ? "⌘" : "Ctrl+", ctrl: mac ? "⌃" : "Ctrl+", shift: mac ? "⇧" : "Shift+", alt: mac ? "⌥" : "Alt+", option: mac ? "⌥" : "Alt+" };
    const b = keys().find((k) => k.section === "global" && k.action === "app.palette");
    const parts = b && b.keys.endsWith("--") ? [...b.keys.slice(0, -2).split("-"), "-"] : b?.keys.split("-");
    const key = parts && parts.map((p) => mod[p.toLowerCase()] ?? p.toUpperCase()).join("");
    return key ? `${key}  commands` : "commands";
  }

  usageAccounts(kind) {
    const latest = shared("account-usage.latest");
    const results = Array.isArray(latest?.results) ? latest.results : [];
    return results.filter((item) => item.kind === kind);
  }

  usageSummary(kind) {
    return mostUrgentUsage(this.usageAccounts(kind));
  }

  usageColor(t, percent) {
    if (percent == null) return t.dim;
    if (percent >= 90) return t.ansi1;
    if (percent >= 70) return t.ansi3;
    return t.ansi2;
  }

  miniBar(t, kind, accounts, summary) {
    const percent = summary?.percent;
    const filled = percent == null ? 0 : Math.round(percent / 10);
    const account = accounts.find((item) => item.id === summary?.accountId) ?? accounts[0];
    const color = account?.color ?? PROVIDER_COLORS[kind] ?? t.dim;
    const provider = kind === "codex" ? "Codex" : "Claude";
    const meta = compactUsageMetaLabel(accounts.length, summary);
    const detail = percent == null ? provider : `${account?.label ?? provider}: ${Math.round(percent)}%`;
    return h_flex().gap(4).items_center()
      .child(div().size(14).flex_none().rounded(4).bg(account ? `${color}2B` : t.raised).flex().items_center().justify_center().tooltip(detail)
        .child(svg(`icons/${kind}.svg`).size(9).text_color(color)))
      .when(Boolean(meta), (el) => el.child(div().text_size(9).text_color(t.dim).child(meta)))
      .child(h_flex().gap(1).children(Array.from({ length: 10 }, (_, index) =>
        div().w(3).h(4).rounded(1).bg(index < filled ? this.usageColor(t, percent) : t.raised))));
  }

  usageIndicator(t) {
    const codex = this.usageAccounts("codex");
    const claude = this.usageAccounts("claude");
    const codexSummary = this.usageSummary("codex");
    const claudeSummary = this.usageSummary("claude");
    const mode = claude.length === 1 ? claude[0].authMode : null;
    const ready = claude.length === 1 && mode === "api" && Number.isFinite(claude[0].session?.usedPercent) && claude[0].session.usedPercent < 100;
    return h_flex().gap(7).items_center()
      .child(this.miniBar(t, "codex", codex, codexSummary))
      .child(this.miniBar(t, "claude", claude, claudeSummary))
      .when(mode === "api", (el) => el.child(h_flex().gap(3).items_center().text_size(9).text_color(ready ? t.ansi1 : t.dim)
        .when(ready, (marker) => marker.child(div().size(5).rounded_full().bg(t.ansi1)))
        .child("API")))
      .when(mode === "subscription", (el) => el.child(div().text_size(9).text_color(t.done).child("Sub")));
  }

  render() {
    const t = theme();
    const space = spaces().find(s => s.active);
    const list = agents();
    const needs = list.filter(a => a.status === "blocked").length;
    const label = (icon, text) => h_flex().gap(6).items_center().child(svg(`mods/workspace-chrome/${icon}.svg`).size(13)).child(text);
    return h_flex().size_full().px(14).gap(16).items_center().bg(t.chrome).border_t(1).border_color(t.border).text_size(11.8).text_color(t.muted)
      .child(label(space?.machine ? "server" : "monitor", space?.machine ?? "This computer"))
      .when(Boolean(space?.branch), el => el.child(label("branch", space.branch)))
      .child(h_flex().gap(6).items_center().child(div().size(6).rounded(3).bg(t.dim)).child(`${list.length} agents`)
        .when(needs > 0, el => el.child(div().text_color(t.blocked).child(`· ${needs} needs you`))))
      .child(div().flex_1())
      .child(h_flex().id("account-usage").px(6).py(2).items_center().rounded(5).cursor_pointer().text_size(10.5).text_color(t.dim)
        .hover((el) => el.bg(t.hover).text_color(t.foreground))
        .on_click(() => run("mod.open", { name: "account-usage" }))
        .child(this.usageIndicator(t)))
      .child(div().id("palette").text_color(t.dim).on_click(() => run("app.palette")).child(this.hint(t)));
  }
}
