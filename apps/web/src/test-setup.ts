import "@testing-library/jest-dom/vitest";

// jsdom은 scrollIntoView를 구현하지 않는다 — PlayScreen의 자동 스크롤 effect가 던지지 않게 no-op으로 채운다.
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => {};
}
