import { useEffect, useRef } from "react";
import { Application, Assets, Container, FederatedPointerEvent, Graphics, Sprite, Text, TextStyle } from "pixi.js";
import type { Grid, Ping, Token } from "../table-reducer.js";
import { initialOf, ringColorFor } from "../pixel-token.js";

// CLAUDE.md §6 — 색은 CSS 변수로 정의돼 있지만 PixiJS는 CSS를 못 읽으므로 여기서 숫자로 복제한다.
const CANDLE = 0xe8a13d;
const CANDLE_BRIGHT = 0xf4be6c;
const WOOD_EDGE = 0x4c3a27;
const EMBER = 0xc75146;
const CHAR = 0x1b1410;
const PARCHMENT = 0xefdfb8;

const PING_LIFETIME_MS = 1400;
const TOKEN_RADIUS = 14;

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
  const layersRef = useRef<{ map: Container; grid: Graphics; tokens: Container; pings: Container } | null>(null);
  const mapSpriteRef = useRef<Sprite | null>(null);
  const redrawAllRef = useRef<(() => void) | null>(null);
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
      const gridLayer = new Graphics();
      const tokensLayer = new Container();
      const pingsLayer = new Container();
      app.stage.addChild(mapLayer, gridLayer, tokensLayer, pingsLayer);
      layersRef.current = { map: mapLayer, grid: gridLayer, tokens: tokensLayer, pings: pingsLayer };

      app.canvas.addEventListener("dblclick", (ev: MouseEvent) => {
        const rect = app.canvas.getBoundingClientRect();
        const px = ev.clientX - rect.left;
        const py = ev.clientY - rect.top;
        const g = toGrid(propsRef.current.grid, px, py);
        propsRef.current.onPing(g.x, g.y);
      });

      app.ticker.add(() => redrawPings());

      redrawAll();
    })();

    function redrawAll(): void {
      redrawMap();
      redrawGrid();
      redrawTokens();
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
  }, [props.mapPath, props.grid.cellSize, props.grid.offsetX, props.grid.offsetY, props.tokens, props.resyncKey]);

  return <div ref={wrapRef} className="hs-table-canvas-wrap" />;
}
