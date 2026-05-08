# ODROID M1S 배포 파일

이 디렉터리는 `parking-radar`를 `ODROID M1S`에 배포할 때 쓰는 보조 파일을 모아둔다.

## 파일 설명

- [remote-deploy.sh](</F:/dev/parking-radar/deploy/odroid/remote-deploy.sh>)
  - 원격 서버에서 `docker compose build`와 `docker compose up -d`를 실행한다.
- [bootstrap-docker.sh](</F:/dev/parking-radar/deploy/odroid/bootstrap-docker.sh>)
  - Ubuntu 24.04 기준 Docker와 Compose plugin을 설치하는 1회성 스크립트다.
  - 실제 실행은 설치가 필요할 때만 한다.

## 로컬 설정 파일

- 루트의 [.env.odroid](</F:/dev/parking-radar/.env.odroid>)
  - 배포 대상 IP, 사용자, 앱 디렉터리, 포트, 공공데이터 인증키를 저장한다.
  - 비밀번호는 저장하지 않는다.
  - 현재 ODROID 기준 API 공개 포트는 `18000`이다.
    - `8000` 포트는 Portainer가 사용 중이라 충돌을 피한다.

## 로컬 실행 스크립트

- [scripts/deploy-odroid.ps1](</F:/dev/parking-radar/scripts/deploy-odroid.ps1>)
  - 로컬 프로젝트를 압축해서 원격 서버로 전송하고 배포까지 실행한다.
- [scripts/odroid-status.ps1](</F:/dev/parking-radar/scripts/odroid-status.ps1>)
  - 배포 후 웹/API 상태와 최근 수집 상태를 요약해서 보여준다.

## 운영 호환성 메모

- 원격 서버의 Docker Compose 구현은 환경마다 다를 수 있다.
- `parking-radar` 배포 스크립트는 `docker compose`와 `docker-compose`를 모두 지원해야 한다.
- 원격 서버에서 `.env.odroid`를 먼저 로드하므로 Compose CLI의 `--env-file` 지원 유무에 의존하지 않는 구성을 유지한다.
- `docker-compose 1.29` 환경에서는 재생성 버그를 피하려고 `down --remove-orphans` 후 일반 `up -d` 순서를 사용한다.
- 백엔드가 healthy가 된 뒤 프론트를 올리는 순서를 사용해 초기 healthcheck 경합을 줄인다.
