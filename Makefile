.PHONY: clean dev prod up-dev up-prod


clean:
	docker system prune

dev:
	docker-compose build dev

prod:
	docker-compose build prod

up-dev:
	docker-compose up dev

up-prod:
	docker run --log-driver json-file --log-opt max-size=32m --log-opt max-file=1 --restart=always --name=aiogram-chat-manager -it -d aiogram_chat_manager/project:latest-prod
