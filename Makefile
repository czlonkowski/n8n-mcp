tag := red
service := n8n-mcp-server-oci
port := 3000

main_image := registry.internal.telnyx.com/jenkins/$(service):$(tag)
node_version := 22

docker_build_args = \
	--build-arg GIT_COMMIT=$(shell git show -s --format=%H) \
	--build-arg GIT_COMMIT_DATE="$(shell git show -s --format=%ci)" \
	--build-arg IMAGE_NAME=$(service) \
	--build-arg BUILD_DATE=$(shell date -u +"%Y-%m-%dT%T.%N%Z") \
	--build-arg BUILD_URL=$(BUILD_URL) \
	--build-arg VER_NODE=$(node_version) \

.PHONY: build
build:
	docker build $(docker_build_args) --tag $(main_image) .

.PHONY: start
start:
	docker run -d -p $(port):$(port) --env-file .env $(main_image)

.PHONY: run
run:
	docker run -it --rm -p $(port):$(port) --env-file .env $(main_image)

.PHONY: stop
stop:
	docker stop $$(docker ps -q --filter ancestor=$(main_image)) || true

.PHONY: clean
clean:
	docker rm $$(docker ps -aq --filter ancestor=$(main_image)) || true

.PHONY: test
test:
	@echo "************  NO TESTING YET ************"
	@echo "Use 'npm test' locally to run the comprehensive test suite (79 test files)"
	@echo "Docker build and TypeScript compilation will validate basic functionality"

.PHONY: local-build
local-build:
	npm install
	npm run build
	npm run rebuild