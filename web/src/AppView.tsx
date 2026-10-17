import { useEffect, useRef, useState } from "react";
import { mountApp, type AppInstance, type AppMessage, type AppContextUpdate, type ApprovalRequest, type HostApi, type MountedApp } from "@agentic-host/core";

/** React wrapper around core's mountApp. All the real work lives in core (framework-free). */
export function AppView(props: {
  app: AppInstance;
  api: HostApi;
  sandboxUrl: string;
  theme: "light" | "dark";
  onMessage: (msg: AppMessage, app: AppInstance) => Promise<boolean>;
  onContextUpdate: (ctx: AppContextUpdate | null, app: AppInstance) => void;
  onApprovalRequest: (req: Omit<ApprovalRequest, "id">, app: AppInstance) => Promise<boolean>;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const mounted = useRef<MountedApp | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Keep the latest callbacks without re-mounting the iframe.
  const cb = useRef(props);
  cb.current = props;

  useEffect(() => {
    let cancelled = false;
    const el = ref.current!;
    mountApp({
      container: el,
      app: props.app,
      api: props.api,
      sandboxUrl: props.sandboxUrl,
      theme: props.theme,
      onMessage: (m, a) => cb.current.onMessage(m, a),
      onContextUpdate: (c, a) => cb.current.onContextUpdate(c, a),
      onApprovalRequest: (r, a) => cb.current.onApprovalRequest(r, a),
      log: (...a) => console.debug("[app]", ...a),
    }).then((m) => {
      if (cancelled) void m.dispose();
      else mounted.current = m;
    }).catch((e) => setError(e instanceof Error ? e.message : String(e)));
    return () => {
      cancelled = true;
      void mounted.current?.dispose();
      mounted.current = null;
      el.innerHTML = "";
    };
    // Mount once per app instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [props.app.id]);

  useEffect(() => { mounted.current?.setTheme(props.theme); }, [props.theme]);

  return (
    <div className="app-card">
      <div className="app-card-head">
        <span className="app-dot" />
        <span>{props.app.server}</span>
        <span className="muted">· {props.app.toolName}</span>
      </div>
      {error ? <div className="app-error">Couldn't load this app: {error}</div> : null}
      <div ref={ref} className="app-frame-host" data-app-id={props.app.id} />
    </div>
  );
}
