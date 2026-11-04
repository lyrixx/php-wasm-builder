<?php

namespace App\Entity;

use Doctrine\ORM\Mapping as ORM;
use Symfony\Component\Validator\Constraints as Assert;

#[ORM\Entity]
class Message
{
    #[ORM\Id, ORM\GeneratedValue, ORM\Column]
    public ?int $id = null;

    #[ORM\Column(length: 50), Assert\NotBlank, Assert\Length(max: 50)]
    public string $author = '';

    #[ORM\Column(length: 1000), Assert\NotBlank, Assert\Length(max: 1000)]
    public string $text = '';

    #[ORM\Column]
    public \DateTimeImmutable $createdAt;

    public function __construct()
    {
        $this->createdAt = new \DateTimeImmutable();
    }
}
