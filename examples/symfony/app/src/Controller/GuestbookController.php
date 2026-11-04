<?php

namespace App\Controller;

use App\Entity\Message;
use Doctrine\ORM\EntityManagerInterface;
use Symfony\Bundle\FrameworkBundle\Controller\AbstractController;
use Symfony\Component\Form\Extension\Core\Type\SubmitType;
use Symfony\Component\Form\Extension\Core\Type\TextareaType;
use Symfony\Component\HttpFoundation\Request;
use Symfony\Component\HttpFoundation\Response;
use Symfony\Component\Routing\Attribute\Route;

final class GuestbookController extends AbstractController
{
    #[Route('/', name: 'guestbook')]
    public function index(Request $request, EntityManagerInterface $entityManager): Response
    {
        $session = $request->getSession();

        $message = new Message();
        // Who signed last, in this session
        $message->author = $session->get('author', '');
        $form = $this->createFormBuilder($message)
            ->add('author')
            ->add('text', TextareaType::class)
            ->add('sign', SubmitType::class)
            ->getForm()
            ->handleRequest($request);

        if ($form->isSubmitted() && $form->isValid()) {
            $entityManager->persist($message);
            $entityManager->flush();
            $session->set('author', $message->author);
            $this->addFlash('success', 'Thanks for signing!');

            return $this->redirectToRoute('guestbook');
        }

        $session->set('views', $session->get('views', 0) + 1);

        return $this->render('guestbook/index.html.twig', [
            'form' => $form,
            'messages' => $entityManager->getRepository(Message::class)->findBy([], ['id' => 'DESC']),
            'views' => $session->get('views'),
        ]);
    }

    #[Route('/forget-me', name: 'forget_me', methods: ['POST'])]
    public function forgetMe(Request $request): Response
    {
        $request->getSession()->invalidate();

        return $this->redirectToRoute('guestbook');
    }
}
