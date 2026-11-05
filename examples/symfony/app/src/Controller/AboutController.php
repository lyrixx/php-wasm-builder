<?php

namespace App\Controller;

use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\HttpKernel\Kernel;
use Symfony\Component\Routing\Attribute\Route;

final class AboutController extends AbstractController
{
    #[Route('/about', name: 'about')]
    public function index(Request $request): Response
    {
        $extensions = get_loaded_extensions();
        natcasesort($extensions);

        return $this->render('about/index.html.twig', [
            'extensions' => $extensions,
            // What runs PHP, that says it in a header. Keep in sync with
            // ../../../public/index.html and ../../../public/standalone/sw.js
            'php_runs_in' => $request->headers->get('X-PHP-Runs-In', 'somewhere unknown'),
            'symfony_version' => Kernel::VERSION,
        ]);
    }
}
