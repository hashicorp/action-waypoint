project = "example-nginx"

app "example-nginx" {
  labels = {
    "service" = "example-nginx",
    "env" = "dev"
  }

  build {
    use "docker" {}
  }

  deploy {
    use "docker" {}
  }
}
