const ROUTES = Object.freeze({
  subscription: Object.freeze({ id: "subscription", label: "Subscription" }),
  api: Object.freeze({ id: "api", label: "API" }),
});

export function sessionRoute(labels) {
  const route = labels?.["herdr.billing.route"];
  return typeof route === "string" ? ROUTES[route] ?? null : null;
}
