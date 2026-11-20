target "default" {
  context = "docker"
  output = ["type=local,dest=./build/php-8.6"]
  tags = ["php-wasm"]
}
