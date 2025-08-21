#!/bin/bash

# Emark News Service 자동화 스크립트
# 사용: bash setup.sh

# 1. 의존성 설치
echo "Installing dependencies..."
npm init -y
npm install axios rss-parser ioredis crypto express cors

# 2. .env 파일 생성 (더미 값)
if [ ! -f .env ]; then
  echo "Creating .env with dummies..."
  cat <<EOT > .env
REDIS_URL=redis://localhost:6379
X_BEARER_TOKEN=dummy_token
REDDIT_TOKEN=dummy_token
REDDIT_USER_AGENT=emark-buzz/1.0
YOUTUBE_API_KEY=dummy_key
FAST_PHASE1_DEADLINE_MS=600
# ... (다른 env vars 추가)
EOT
fi

# 3. Redis 확인 (로컬 Redis 시작 가정; 설치 안 됨 시 안내)
if ! command -v redis-server &> /dev/null; then
  echo "Redis not found. Install Redis: brew install redis (Mac) or sudo apt install redis-server (Linux)."
  exit 1
fi
redis-server --daemonize yes

# 4. 서버 시작 (background)
echo "Starting server..."
node app.js &  # app.js는 Express 부분
SERVER_PID=$!

# 5. 기본 테스트 (curl로 엔드포인트 호출)
sleep 5  # 서버 시작 대기
echo "Testing /api/buzz/fast..."
curl -s http://localhost:8080/api/buzz/fast > test_fast.json
echo "Response saved to test_fast.json"

echo "Testing /api/world..."
curl -s http://localhost:8080/api/world > test_full.json
echo "Response saved to test_full.json"

# 6. 정리
echo "Server running (PID: $SERVER_PID). Stop with kill $SERVER_PID"
echo "Done! Check test files for outputs."