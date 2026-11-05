<?php

#[\Deprecated('first')]
const FIRST = 1;

#[\Deprecated('second')]
const SECOND = 2;

echo json_encode(array_map(
    static fn (string $name): array => (new ReflectionConstant($name))->getAttributes()[0]->getArguments(),
    ['FIRST', 'SECOND'],
));
