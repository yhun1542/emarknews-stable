#!/bin/bash
set -e

echo "===== EmarkNews Railway 배포 스크립트 ====="
echo "1. 프로젝트 연결 확인"
if ! railway whoami &>/dev/null; then
  echo "Railway에 로그인되어 있지 않습니다. 'railway login' 명령어로 로그인해주세요."
  exit 1
fi

echo "2. 환경 변수 설정"
railway variables set NODE_ENV=production NIXPACKS_NODE_VERSION=18

echo "3. 배포 시작"
railway up

echo "4. 배포 상태 확인"
railway status

echo "5. 배포 URL 확인"
railway domain

echo "===== 배포 완료 ====="
echo "다음 엔드포인트를 테스트해보세요:"
echo "- Health Check: GET /health"
echo "- API 테스트: GET /api/news/world"
echo "- AI 기능 테스트: POST /api/translate, POST /api/summarize"

