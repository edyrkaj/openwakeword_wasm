# Release helpers for @edyrkaj/openwakeword-wasm-browser
# CI publishes on annotated tags matching package.json version (v*).

VERSION := $(shell node -p "require('./package.json').version")
TAG     := v$(VERSION)
REMOTE  ?= origin
BRANCH  ?= main

.PHONY: help check status push push-branch tag release retag view

help:
	@echo "Targets (version=$(VERSION) tag=$(TAG)):"
	@echo "  make check         Run pack + README gates (npm run prepack:check)"
	@echo "  make status        Show git status / remotes / tags"
	@echo "  make push-branch   Push $(BRANCH) to $(REMOTE)"
	@echo "  make tag           Create annotated tag $(TAG) (local only)"
	@echo "  make release       check + push-branch + tag + push tag $(TAG)"
	@echo "  make retag         Delete remote/local $(TAG), recreate, push (re-run CI)"
	@echo "  make view          npm view published package"

check:
	npm run prepack:check

status:
	@git status -sb
	@echo "---"
	@git rev-parse --abbrev-ref HEAD
	@git remote -v | head -2
	@echo "package.json version: $(VERSION)"
	@echo "expected tag:         $(TAG)"
	@git tag -l '$(TAG)' || true

push-branch:
	git push $(REMOTE) $(BRANCH)

tag:
	@if git rev-parse $(TAG) >/dev/null 2>&1; then \
		echo "Tag $(TAG) already exists locally. Use 'make retag' to recreate."; \
		exit 1; \
	fi
	git tag -a $(TAG) -m "Release @edyrkaj/openwakeword-wasm-browser@$(VERSION)"

release: check push-branch tag
	git push $(REMOTE) $(TAG)
	@echo "Pushed $(TAG). Watch Actions → Publish npm package."
	@echo "Verify: make view"

# Use when the tag exists but CI failed / needs a re-run with new workflow commits.
retag: check push-branch
	-git push $(REMOTE) :refs/tags/$(TAG)
	-git tag -d $(TAG)
	git tag -a $(TAG) -m "Release @edyrkaj/openwakeword-wasm-browser@$(VERSION)"
	git push $(REMOTE) $(TAG)
	@echo "Re-pushed $(TAG). Watch Actions → Publish npm package."

view:
	npm view @edyrkaj/openwakeword-wasm-browser version name dist.tarball 2>/dev/null || \
		echo "Package not on registry yet (or not logged in / network)."
