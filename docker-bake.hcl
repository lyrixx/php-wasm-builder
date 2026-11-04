target "default" {
  context = "docker"
  output = ["type=local,dest=./build/php-8.5"]
  tags = ["php-wasm"]
}
