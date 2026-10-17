/*
 * Sandbox proxy: the OUTER iframe, served from a different origin than the host app.
 * It creates an INNER iframe for the untrusted View and relays JSON-RPC messages both ways.
 *
 *   host page  <->  this proxy (sandbox origin)  <->  inner iframe (the MCP App View)
 *
 * Adapted from modelcontextprotocol/ext-apps examples/basic-host/src/sandbox.ts (MIT / Apache-2.0).
 */
(function () {
  "use strict";
  var ALLOWED = window.__ALLOWED_HOST_ORIGINS__ || [];
  var DEV_DEFAULT = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/;

  if (window.self === window.top) throw new Error("sandbox proxy must run inside an iframe");
  if (!document.referrer) throw new Error("no referrer; cannot validate the embedding host");

  var HOST_ORIGIN = new URL(document.referrer).origin;
  var allowed = ALLOWED.length ? ALLOWED.indexOf(HOST_ORIGIN) >= 0 : DEV_DEFAULT.test(HOST_ORIGIN);
  if (!allowed) throw new Error("host origin not allowed: " + HOST_ORIGIN);

  var OWN_ORIGIN = window.location.origin;
  if (OWN_ORIGIN === HOST_ORIGIN) throw new Error("sandbox must be on a different origin than the host");

  // Self-test: reaching into the top window MUST fail. If it doesn't, isolation is broken.
  try {
    void window.top.document;
    throw "FAIL";
  } catch (e) {
    if (e === "FAIL") throw new Error("sandbox is not isolated from the host");
  }

  var inner = document.createElement("iframe");
  inner.setAttribute("sandbox", "allow-scripts allow-same-origin allow-forms");
  document.body.appendChild(inner);

  var PERMISSION_FEATURES = { camera: "camera", microphone: "microphone", geolocation: "geolocation", clipboardWrite: "clipboard-write" };
  function allowAttribute(perms) {
    if (!perms) return "";
    return Object.keys(PERMISSION_FEATURES).filter(function (k) { return perms[k]; })
      .map(function (k) { return PERMISSION_FEATURES[k]; }).join("; ");
  }

  window.addEventListener("message", function (event) {
    if (event.source === window.parent) {
      if (event.origin !== HOST_ORIGIN) return;
      var data = event.data;
      if (data && data.method === "ui/notifications/sandbox-resource-ready") {
        var p = data.params || {};
        if (typeof p.sandbox === "string") inner.setAttribute("sandbox", p.sandbox);
        var allow = allowAttribute(p.permissions);
        if (allow) inner.setAttribute("allow", allow);
        if (typeof p.html === "string") {
          // document.write keeps the CSP header of this page in force for the View
          var doc = inner.contentDocument || (inner.contentWindow && inner.contentWindow.document);
          if (doc) { doc.open(); doc.write(p.html); doc.close(); } else { inner.srcdoc = p.html; }
        }
      } else if (inner.contentWindow) {
        inner.contentWindow.postMessage(data, "*");
      }
    } else if (event.source === inner.contentWindow) {
      if (event.origin !== OWN_ORIGIN) return;
      window.parent.postMessage(event.data, HOST_ORIGIN);
    }
  });

  window.parent.postMessage({ jsonrpc: "2.0", method: "ui/notifications/sandbox-proxy-ready", params: {} }, HOST_ORIGIN);
})();
