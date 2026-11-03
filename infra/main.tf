terraform {
  required_providers {
    aws = { source = "hashicorp/aws", version = "~> 6.0" }
  }
}

variable "region" {
  default = "us-west-2"
}

provider "aws" {
  region = var.region
  default_tags { tags = { Project = "mango-links" } }
}

# --- Container registry ---

resource "aws_ecr_repository" "app" {
  name         = "mango-links"
  force_delete = true
  image_scanning_configuration { scan_on_push = true }
}

# Free tier gives 500 MB of ECR storage; keep only the last 3 images
resource "aws_ecr_lifecycle_policy" "app" {
  repository = aws_ecr_repository.app.name
  policy = jsonencode({
    rules = [{
      rulePriority = 1
      selection    = { tagStatus = "any", countType = "imageCountMoreThan", countNumber = 3 }
      action       = { type = "expire" }
    }]
  })
}

# --- Network: one public subnet, only port 80 open. No SSH; shell access is via SSM ---
# (This account has no default VPC, so we own the network here)

resource "aws_vpc" "main" {
  cidr_block           = "10.0.0.0/16"
  enable_dns_hostnames = true
  tags                 = { Name = "mango-links" }
}

resource "aws_internet_gateway" "main" {
  vpc_id = aws_vpc.main.id
}

# dev-note: single public subnet/AZ; add a second AZ + ALB if we need failover
resource "aws_subnet" "public" {
  vpc_id                  = aws_vpc.main.id
  cidr_block              = "10.0.1.0/24"
  map_public_ip_on_launch = true
}

resource "aws_route_table" "public" {
  vpc_id = aws_vpc.main.id
  route {
    cidr_block = "0.0.0.0/0"
    gateway_id = aws_internet_gateway.main.id
  }
}

resource "aws_route_table_association" "public" {
  subnet_id      = aws_subnet.public.id
  route_table_id = aws_route_table.public.id
}

resource "aws_security_group" "web" {
  name   = "mango-links-web"
  vpc_id = aws_vpc.main.id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    description = "ECR pulls, OS updates, SSM"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }
}

# --- IAM: instance can pull from ECR and be managed by SSM, nothing else ---

resource "aws_iam_role" "ec2" {
  name = "mango-links-ec2"
  assume_role_policy = jsonencode({
    Version   = "2012-10-17"
    Statement = [{ Effect = "Allow", Action = "sts:AssumeRole", Principal = { Service = "ec2.amazonaws.com" } }]
  })
}

resource "aws_iam_role_policy_attachment" "ssm" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore"
}

resource "aws_iam_role_policy_attachment" "ecr" {
  role       = aws_iam_role.ec2.name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_iam_instance_profile" "ec2" {
  name = "mango-links-ec2"
  role = aws_iam_role.ec2.name
}

# --- The server ---

data "aws_ssm_parameter" "al2023" {
  name = "/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64"
}

resource "aws_instance" "app" {
  ami                    = data.aws_ssm_parameter.al2023.value
  instance_type          = "t3.micro" # free tier eligible
  subnet_id              = aws_subnet.public.id
  vpc_security_group_ids = [aws_security_group.web.id]
  iam_instance_profile   = aws_iam_instance_profile.ec2.name

  metadata_options { http_tokens = "required" } # IMDSv2 only
  root_block_device {
    volume_type = "gp3"
    volume_size = 8
    encrypted   = true
  }

  user_data = templatefile("${path.module}/user_data.sh", {
    region   = var.region
    registry = split("/", aws_ecr_repository.app.repository_url)[0]
    image    = "${aws_ecr_repository.app.repository_url}:latest"
  })
  lifecycle { ignore_changes = [ami] } # don't replace the box (and its DB) on every new AMI

  tags = { Name = "mango-links" }
}

# Stable public IP across stop/start
resource "aws_eip" "app" {
  instance   = aws_instance.app.id
  depends_on = [aws_internet_gateway.main]
}

output "url" {
  value = "http://${aws_eip.app.public_ip}"
}

output "ecr_repository_url" {
  value = aws_ecr_repository.app.repository_url
}

output "instance_id" {
  value = aws_instance.app.id
}

output "region" {
  value = var.region
}
