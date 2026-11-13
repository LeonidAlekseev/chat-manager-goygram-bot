FROM python:3.11.5 as base

WORKDIR /home/project

COPY requirements.txt requirements.txt

RUN pip install --upgrade pip && pip install -r requirements.txt


# development image.
FROM base as development

COPY requirements_dev.txt requirements_dev.txt

RUN pip install -r requirements_dev.txt


# production image.
FROM base as production

WORKDIR /production

COPY . .

ENV MODE=production

ENTRYPOINT [ "./scripts/start.sh" ]