target "default" {
  contexts = {
    embed = "./examples/embed"
  }
  args = {
    EMBED_PATH = "examples"
  }
  output = ["type=local,dest=./build/default"]
  tags = ["php-wasm"]
}
