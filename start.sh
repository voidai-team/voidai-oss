#!/bin/bash

GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
NC='\033[0m'

echo -e "${GREEN}Starting VoidAI Production Environment...${NC}"

if [ ! -f .env ]; then
    echo -e "${RED}Error: .env file not found!${NC}"
    echo "Please create .env file with production values."
    exit 1
fi

export $(cat .env | grep -v '^#' | xargs)

echo -e "${GREEN}Starting production services...${NC}"
docker compose up -d --build --force-recreate --remove-orphans

echo -e "${GREEN}Production services started!${NC}"
echo "View logs with: docker compose logs app -f"