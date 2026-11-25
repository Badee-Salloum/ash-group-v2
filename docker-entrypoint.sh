#!/bin/sh
set -e

# Database migrations and seed data are handled by an explicit release job.
# Running either here creates lock contention and makes every scaled container
# mutate production state.
exec node server.js
