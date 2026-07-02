# 배포 — Synology DS920+

> 컨테이너: `docker/Dockerfile` + `docker/docker-compose.yml`, 앱 컨테이너 1개.
> coturn(WebRTC용)은 3단계에서 추가한다 — 이번 단계는 app 하나뿐이다.

## 1. 사전 준비

1. DSM → **패키지 센터**에서 **Container Manager**(구 Docker) 설치.
2. File Station 등으로 이 리포를 NAS의 아무 공유 폴더에 올린다. 예: `/volume1/docker/hearthside`.
3. `docker/.env.example`을 `docker/.env`로 복사하고 값을 채운다:
   - `SESSION_SECRET`: 긴 무작위 문자열 고정값. **비워두면 컨테이너를 재시작할 때마다
     서버가 새 키를 생성해서 기존 로그인 쿠키가 전부 무효화된다.**
   - `INVITE_CODE`: 서비스에 들어오는 데 필요한 초대코드. 비워두면 검사를 건너뛴다(개발용).

## 2. 빌드 및 실행

DS920+에 SSH로 접속하거나 Container Manager의 터미널에서:

```bash
cd /volume1/docker/hearthside/docker
docker compose --env-file .env up -d --build
```

`docker compose up`은 `docker/Dockerfile`의 멀티스테이지 빌드(의존성 설치 → 웹 정적 자산
빌드 → 실행 이미지)를 실행하고, 앱을 포트 3000으로 띄운다. 데이터는 named volume
`hearthside_data`에 쌓인다(SQLite DB 파일 하나 — `/data/hearthside.db`).

## 3. 외부 접속

둘 중 하나:

- **Synology 역프록시 + DDNS**: DSM → 제어판 → 로그인 포털 → 고급 → 역방향 프록시에서
  `hearthside.내도메인.synology.me` → `localhost:3000` 규칙 추가. DDNS는 제어판 →
  외부 액세스에서 설정. HTTPS 인증서는 DSM의 Let's Encrypt 통합으로 자동 발급.
- **Tailscale**: NAS와 클라이언트 기기 양쪽에 Tailscale 설치 후 같은 tailnet에 연결하면
  `http://<NAS의-tailscale-IP>:3000`으로 바로 접속 가능. 역프록시/DDNS 설정이 필요 없어
  더 간단하지만, 접속자 전원이 tailnet에 있어야 한다.

## 4. 백업

백업 대상은 **`hearthside_data` 볼륨 하나뿐**이다(SQLite WAL 파일 포함). DSM의
**Hyper Backup**으로 Docker 볼륨이 저장되는 실제 경로
(`/volume1/@docker/volumes/hearthside_data/_data` 또는 Container Manager 설정에 표시되는 경로)를
백업 작업에 추가하면 된다. 콘텐츠(`content/modules/`)는 이미지에 함께 빌드되어 들어가므로
별도 백업이 필요 없다 — 시나리오를 바꾸려면 이미지를 다시 빌드해서 재배포한다.

## 5. 재시작·업데이트 확인

```bash
docker compose restart app     # 재시작 후에도 진행 중인 플레이가 같은 지점에서 이어지는지 확인
docker compose logs -f app     # 기동 로그 확인 — "화롯가 서버가 촛불을 켰다" 메시지가 보여야 한다
```

## 6. 이번 단계에서 실제로 검증한 것

개발 환경에 Docker Desktop을 설치하고 `docker compose -f docker/docker-compose.yml up --build`로
직접 이미지 빌드·기동까지 실행해 확인했다:

- 빌드: `better-sqlite3` 네이티브 모듈이 `deps` 스테이지(python3/make/g++)에서 정상 컴파일됨,
  `apps/web` 정적 자산 빌드 성공, 최종 이미지 export 성공.
- 최초 CMD로 썼던 `node node_modules/.bin/tsx ...`는 tsx의 shebang 스크립트를 `node`로 직접
  실행해서 `SyntaxError`가 났다 — `CMD ["node_modules/.bin/tsx", "apps/server/src/index.ts"]`로
  고쳐서(실행 파일을 shebang으로 직접 실행) 해결했다. Dockerfile에 이미 반영되어 있다.
- 브라우저로 컨테이너의 3000번 포트에 접속해 로그인 → 서가 → 플레이 → 판정 → 엔딩까지 완주.
- 판정 대기 상태에서 `docker restart`로 컨테이너를 재시작한 뒤에도 정확히 그 지점에서
  이어짐을 API로 확인(NAS 재부팅 시나리오와 동일).
- `docker stats` 기준 유휴 메모리 **약 70MiB** — §8 예산(500MB) 대비 충분한 여유.

DS920+ 실기 환경에서는 아직 실행해보지 않았다 — 위 항목은 로컬 Docker Desktop(Windows,
WSL2 백엔드) 기준이다. NAS의 CPU 아키텍처가 동일하게 x86_64(Celeron J4125)이므로 이미지가
그대로 동작할 것으로 예상하지만, 최초 배포 시 `docker compose logs -f app`으로 기동 로그를
한 번 확인하는 것을 권장한다.
