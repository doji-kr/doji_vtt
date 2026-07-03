import { useEffect, useRef } from "react";
import { Application, Assets, Container, FederatedPointerEvent, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import type { FogState, Grid, Ping, Token } from "../table-reducer.js";
import { decodeFog } from "../table-reducer.js";
import { initialOf, ringColorFor } from "../pixel-token.js";

// CLAUDE.md §6 — 색은 CSS 변수로 정의돼 있지만 PixiJS는 CSS를 못 읽으므로 여기서 숫자로 복제한다.
const CANDLE = 0xe8a13d;
const CANDLE_BRIGHT = 0xf4be6c;
const WOOD_EDGE = 0x4c3a27;
const EMBER = 0xc75146;
const CHAR = 0x1b1410;
const PARCHMENT = 0xefdfb8;
/** 순검정 — CHAR(앱 배경)와 구분되게, 지도 유무와 무관하게 항상 뚜렷이 대비된다. */
const FOG_COLOR = 0x000000;

const PING_LIFETIME_MS = 1400;
const TOKEN_RADIUS = 14;
/** 브러시 한 번에 드러나는 정사각 반경(셀 단위) — 3×3 블록. */
const FOG_BRUSH_RADIUS = 1;

function hexToNumber(hex: string): number {
  return Number.parseInt(hex.replace("#", ""), 16);
}

export interface TableCanvasProps {
  mapPath: string | null;
  grid: Grid;
  tokens: Token[];
  pings: Ping[];
  selfNickname: string;
  selfRole: "dm" | "player" | null;
  /** 드래그가 끝날 때(놓았을 때)만 호출된다 — 그리드 셀 좌표로. */
  onTokenDragEnd: (tokenId: string, x: number, y: number) => void;
  onPing: (x: number, y: number) => void;
  /** 서버 거부(error) 등으로 강제 재동기화가 필요할 때 이 값을 증가시켜 넘긴다. */
  resyncKey: number;
  /** 4단계 §3: 수동 안개. DM은 항상 안개 없이 전체를 본다 — 채널 분리가 아니라 뷰 모드
   * 차이라 클라이언트가 role로 분기해도 충분하다(서버는 이미 모두에게 같은 마스크를 보낸다). */
  fog: FogState | null;
  /** true면 DM이 브러시 모드다 — 캔버스를 드래그하면 지나간 셀들이 로컬 커서 표시만 되고,
   * 놓을 때 한 번에 fog.reveal로 전송된다(토큰 드래그와 같은 "커밋은 뗄 때" 패턴). */
  fogBrushActive: boolean;
  onFogReveal: (cells: { x: number; y: number }[]) => void;
}

function toPixel(grid: Grid, gx: number, gy: number): { x: number; y: number } {
  return { x: grid.offsetX + gx * grid.cellSize, y: grid.offsetY + gy * grid.cellSize };
}

function toGrid(grid: Grid, px: number, py: number): { x: number; y: number } {
  return { x: (px - grid.offsetX) / grid.cellSize, y: (py - grid.offsetY) / grid.cellSize };
}

export function TableCanvas(props: TableCanvasProps) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const appRef = useRef<Application | null>(null);
  const layersRef = useRef<{ map: Container; fog: Graphics; grid: Graphics; tokens: Container; pings: Container } | null>(
    null,
  );
  const mapSpriteRef = useRef<Sprite | null>(null);
  const redrawAllRef = useRef<(() => void) | null>(null);
  const cleanupBrushRef = useRef<(() => void) | null>(null);
  const propsRef = useRef(props);
  propsRef.current = props;

  // 앱 초기화/파기 — 마운트당 한 번.
  useEffect(() => {
    let destroyed = false;
    const app = new Application();
    const wrap = wrapRef.current!;

    (async () => {
      await app.init({ background: CHAR, resizeTo: wrap, antialias: true });
      if (destroyed) {
        app.destroy(true, { children: true });
        return;
      }
      wrap.appendChild(app.canvas);
      appRef.current = app;

      // 드래그 중 포인터가 토큰의 작은 원(반지름 14px) 바깥으로 나가면 stage 자체에 히트
      // 영역이 없어 pointermove가 갱신되지 않는다(Pixi 기본 동작 — stage는 hitArea가 없으면
      // 자식 도형의 실제 지오메트리로만 히트 테스트한다). stage.hitArea를 화면 전체로 지정해야
      // 드래그가 캔버스 어디로든 따라간다. app.screen은 렌더러가 리사이즈할 때 그대로 갱신되는
      // 참조라 별도 갱신 코드가 필요 없다.
      app.stage.eventMode = "static";
      app.stage.hitArea = app.screen;

      const mapLayer = new Container();
      const fogLayer = new Graphics();
      const gridLayer = new Graphics();
      const tokensLayer = new Container();
      const pingsLayer = new Container();
      // 지도 → 안개 → 그리드 → 토큰 → 핑 순서(PROMPT-stage4.md §3) — 안개가 그리드보다
      // 아래에 있어야 그리드 선이 항상 보여서 방향감을 유지한다.
      app.stage.addChild(mapLayer, fogLayer, gridLayer, tokensLayer, pingsLayer);
      layersRef.current = { map: mapLayer, fog: fogLayer, grid: gridLayer, tokens: tokensLayer, pings: pingsLayer };

      app.canvas.addEventListener("dblclick", (ev: MouseEvent) => {
        const rect = app.canvas.getBoundingClientRect();
        const px = ev.clientX - rect.left;
        const py = ev.clientY - rect.top;
        const g = toGrid(propsRef.current.grid, px, py);
        propsRef.current.onPing(g.x, g.y);
      });

      // 안개 브러시 — 놓을 때 한 번만 fog.reveal을 보낸다(토큰 드래그와 같은 커밋 시점 패턴).
      let brushActive = false;
      const brushAccum = new Map<string, { x: number; y: number }>();

      function cellUnderEvent(ev: MouseEvent): { x: number; y: number } {
        const rect = app.canvas.getBoundingClientRect();
        const px = ev.clientX - rect.left;
        const py = ev.clientY - rect.top;
        const g = toGrid(propsRef.current.grid, px, py);
        return { x: Math.floor(g.x), y: Math.floor(g.y) };
      }

      function addBrushCells(center: { x: number; y: number }): void {
        for (let dy = -FOG_BRUSH_RADIUS; dy <= FOG_BRUSH_RADIUS; dy++) {
          for (let dx = -FOG_BRUSH_RADIUS; dx <= FOG_BRUSH_RADIUS; dx++) {
            const x = center.x + dx;
            const y = center.y + dy;
            if (x < 0 || y < 0) continue;
            brushAccum.set(`${x},${y}`, { x, y });
          }
        }
      }

      function onBrushMouseDown(ev: MouseEvent): void {
        if (!propsRef.current.fogBrushActive || propsRef.current.selfRole !== "dm") return;
        brushActive = true;
        brushAccum.clear();
        addBrushCells(cellUnderEvent(ev));
      }
      function onBrushMouseMove(ev: MouseEvent): void {
        if (!brushActive) return;
        addBrushCells(cellUnderEvent(ev));
      }
      function onBrushMouseUp(): void {
        if (!brushActive) return;
        brushActive = false;
        if (brushAccum.size > 0) propsRef.current.onFogReveal([...brushAccum.values()]);
        brushAccum.clear();
      }
      app.canvas.addEventListener("mousedown", onBrushMouseDown);
      app.canvas.addEventListener("mousemove", onBrushMouseMove);
      window.addEventListener("mouseup", onBrushMouseUp);
      cleanupBrushRef.current = () => {
        window.removeEventListener("mouseup", onBrushMouseUp);
      };

      app.ticker.add(() => redrawPings());

      redrawAll();
    })();

    function redrawAll(): void {
      redrawMap();
      redrawFog();
      redrawGrid();
      redrawTokens();
    }

    function redrawFog(): void {
      const layers = layersRef.current;
      if (!layers) return;
      const g = layers.fog;
      g.clear();
      const { fog, selfRole, grid } = propsRef.current;
      // DM은 항상 전체를 본다 — 안개 레이어 자체를 그리지 않는다(뷰 모드 차이, 비밀 아님).
      if (!fog || selfRole === "dm") return;
      const cells = decodeFog(fog);
      for (let y = 0; y < fog.rows; y++) {
        for (let x = 0; x < fog.cols; x++) {
          if (cells[y * fog.cols + x]) continue;
          const px = toPixel(grid, x, y);
          g.rect(px.x, px.y, grid.cellSize, grid.cellSize);
        }
      }
      // CHAR(캔버스 배경)와 같은 색이면 지도가 없을 때 안개가 배경과 구분되지 않는다 —
      // 순검정 + 높은 알파로 배경/지도 어느 쪽과도 뚜렷이 대비되게 한다.
      g.fill({ color: FOG_COLOR, alpha: 0.96 });
    }

    async function redrawMap(): Promise<void> {
      const layers = layersRef.current;
      if (!layers) return;
      layers.map.removeChildren();
      mapSpriteRef.current = null;
      const path = propsRef.current.mapPath;
      if (!path) return;
      try {
        const texture = await Assets.load(path);
        if (destroyed) return;
        const sprite = new Sprite(texture);
        sprite.x = 0;
        sprite.y = 0;
        layers.map.addChild(sprite);
        mapSpriteRef.current = sprite;
      } catch {
        // 지도를 못 불러와도 화면은 계속 돈다 — 그리드/토큰은 좌표만 있으면 그려진다.
      }
    }

    function redrawGrid(): void {
      const layers = layersRef.current;
      if (!layers) return;
      const g = layers.grid;
      g.clear();
      const grid = propsRef.current.grid;
      const w = mapSpriteRef.current?.width ?? app.screen.width;
      const h = mapSpriteRef.current?.height ?? app.screen.height;
      if (grid.cellSize <= 0) return;
      g.setStrokeStyle({ width: 1, color: CANDLE, alpha: 0.25 });
      for (let x = grid.offsetX; x <= w; x += grid.cellSize) {
        g.moveTo(x, 0).lineTo(x, h);
      }
      for (let y = grid.offsetY; y <= h; y += grid.cellSize) {
        g.moveTo(0, y).lineTo(w, y);
      }
      g.stroke();
    }

    function makeTokenGraphic(token: Token): Container {
      const c = new Container();
      c.eventMode = "static";
      c.cursor = "pointer";

      const ring = new Graphics();
      const color = hexToNumber(ringColorFor(token.colorSeed));
      ring.circle(0, 0, TOKEN_RADIUS).fill(PARCHMENT).stroke({ width: 3, color });
      c.addChild(ring);

      if (token.locked) {
        const lockDot = new Graphics();
        lockDot.circle(TOKEN_RADIUS * 0.7, -TOKEN_RADIUS * 0.7, 3).fill(EMBER);
        c.addChild(lockDot);
      }

      const style = new TextStyle({ fill: CHAR, fontSize: 13, fontWeight: "700" });
      const text = new Text({ text: initialOf(token.label), style });
      text.anchor.set(0.5);
      c.addChild(text);

      let dragging = false;
      let dragStart = { x: 0, y: 0 };

      function canDrag(): boolean {
        const p = propsRef.current;
        if (p.selfRole === "dm") return true;
        if (token.locked) return false;
        return token.ownerNickname === p.selfNickname;
      }

      c.on("pointerdown", (ev: FederatedPointerEvent) => {
        if (!canDrag()) return;
        dragging = true;
        const local = ev.getLocalPosition(app.stage);
        dragStart = { x: local.x - c.x, y: local.y - c.y };
        app.stage.on("pointermove", onMove);
        app.stage.on("pointerup", onUp);
        app.stage.on("pointerupoutside", onUp);
      });

      function onMove(ev: FederatedPointerEvent): void {
        if (!dragging) return;
        const local = ev.getLocalPosition(app.stage);
        c.x = local.x - dragStart.x;
        c.y = local.y - dragStart.y;
      }

      function onUp(): void {
        if (!dragging) return;
        dragging = false;
        app.stage.off("pointermove", onMove);
        app.stage.off("pointerup", onUp);
        app.stage.off("pointerupoutside", onUp);
        const gcoord = toGrid(propsRef.current.grid, c.x, c.y);
        propsRef.current.onTokenDragEnd(token.id, gcoord.x, gcoord.y);
      }

      return c;
    }

    function redrawTokens(): void {
      const layers = layersRef.current;
      if (!layers) return;
      layers.tokens.removeChildren();
      const grid = propsRef.current.grid;
      for (const token of propsRef.current.tokens) {
        const c = makeTokenGraphic(token);
        const px = toPixel(grid, token.x, token.y);
        c.x = px.x;
        c.y = px.y;
        layers.tokens.addChild(c);
      }
    }

    function redrawPings(): void {
      const layers = layersRef.current;
      if (!layers) return;
      layers.pings.removeChildren();
      const grid = propsRef.current.grid;
      const now = Date.now();
      for (const ping of propsRef.current.pings) {
        const age = now - ping.at;
        if (age < 0 || age > PING_LIFETIME_MS) continue;
        const t = age / PING_LIFETIME_MS;
        const px = toPixel(grid, ping.x, ping.y);
        const g = new Graphics();
        const radius = 6 + t * 26;
        g.circle(0, 0, radius).stroke({ width: 3, color: CANDLE_BRIGHT, alpha: 1 - t });
        g.x = px.x;
        g.y = px.y;
        layers.pings.addChild(g);
      }
    }

    redrawAllRef.current = redrawAll;

    return () => {
      destroyed = true;
      cleanupBrushRef.current?.();
      cleanupBrushRef.current = null;
      const app2 = appRef.current;
      appRef.current = null;
      layersRef.current = null;
      mapSpriteRef.current = null;
      redrawAllRef.current = null;
      if (app2) app2.destroy(true, { children: true });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 이 컴포넌트는 매 렌더마다 최신 props를 propsRef에 반영해뒀으니(위), map/grid/tokens/resyncKey가
  // 바뀔 때만 실제로 다시 그린다.
  useEffect(() => {
    redrawAllRef.current?.();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    props.mapPath,
    props.grid.cellSize,
    props.grid.offsetX,
    props.grid.offsetY,
    props.tokens,
    props.resyncKey,
    props.fog,
  ]);

  return <div ref={wrapRef} className="hs-table-canvas-wrap" />;
}
