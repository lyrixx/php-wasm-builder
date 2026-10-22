target "default" {
  context = "docker"
  contexts = {
    embed = "./examples/embed"
  }
  args = {
    EMBED_AT = "/examples"
  }
  output = ["type=local,dest=./build/default"]
  tags = ["php-wasm"]
}
