target "default" {
  contexts = {
    embed = "./examples"
  }
  args = {
    EMBED_PATH = "examples"
  }
  output = ["type=local,dest=./build/default"]
  tags = ["php-wasm"]
}
