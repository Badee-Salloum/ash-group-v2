#!/bin/sh
set -e

echo "⏳ Running database migrations..."
npx prisma migrate deploy

echo "🌱 Running database seed..."
npx tsx prisma/seed.ts

echo "🚀 Starting application..."
exec node server.js
