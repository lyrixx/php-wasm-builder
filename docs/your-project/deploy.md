# Deploy it

GitHub Pages serves `public/`, from GitHub Actions. The layers of the build are kept in the cache of
GitHub Actions, given to `docker buildx bake --set`: a push only compiles what changed. And nothing
is deployed if the checks fail.

=== "castor"

    ```yaml
    # .github/workflows/pages.yaml
    name: Pages

    on:
        push:
            branches: [main]

    permissions:
        contents: read
        pages: write
        id-token: write

    jobs:
        deploy:
            runs-on: ubuntu-latest
            environment:
                name: github-pages
                url: ${{ steps.deployment.outputs.page_url }}
            steps:
                - uses: actions/checkout@v7

                - uses: shivammathur/setup-php@v2
                  with:
                      php-version: '8.5'
                      tools: castor

                - uses: actions/setup-node@v7
                  with:
                      node-version: 24

                # The cache needs the docker-container driver of buildx…
                - uses: docker/setup-buildx-action@v4

                # …and the runtime token and URLs of GitHub Actions, that only
                # actions get
                - uses: crazy-max/ghaction-github-runtime@v4

                - run: castor wasm:build --set '*.cache-from=type=gha' --set '*.cache-to=type=gha,mode=max,ignore-error=true'

                - run: castor wasm:smoke

                - uses: actions/upload-pages-artifact@v5
                  with:
                      path: public

                - id: deployment
                  uses: actions/deploy-pages@v5
    ```

=== "Composer and Docker"

    ```yaml
    # .github/workflows/pages.yaml
    name: Pages

    on:
        push:
            branches: [main]

    permissions:
        contents: read
        pages: write
        id-token: write

    jobs:
        deploy:
            runs-on: ubuntu-latest
            environment:
                name: github-pages
                url: ${{ steps.deployment.outputs.page_url }}
            steps:
                - uses: actions/checkout@v7

                - uses: shivammathur/setup-php@v2
                  with:
                      php-version: '8.5'

                - uses: actions/setup-node@v7
                  with:
                      node-version: 24

                - run: composer install

                # The cache needs the docker-container driver of buildx…
                - uses: docker/setup-buildx-action@v4

                # …and the runtime token and URLs of GitHub Actions, that only
                # actions get
                - uses: crazy-max/ghaction-github-runtime@v4

                # composer wasm:build, with the cache
                - run: |
                      composer wasm:embed
                      docker buildx bake --set '*.cache-from=type=gha' --set '*.cache-to=type=gha,mode=max,ignore-error=true'
                      chmod 755 public/build

                - run: composer wasm:check

                - uses: actions/upload-pages-artifact@v5
                  with:
                      path: public

                - id: deployment
                  uses: actions/deploy-pages@v5
    ```

In the settings of the repository, GitHub Pages must deploy from GitHub Actions.

With several stacks, each one is a target of buildx, named after the stack. The cache of a scope is
what its last build exported: stacks that compile another PHP, with other extensions or another
version, need a scope each, or the cache of one pushes the other out. Stacks that only differ by
what they embed can share one. A `--set` of a target adds to the one of `*.`, it does not replace
it: give the cache target by target.

```
--set 'admin.cache-from=type=gha,scope=admin' --set 'admin.cache-to=type=gha,scope=admin,mode=max,ignore-error=true'
```
