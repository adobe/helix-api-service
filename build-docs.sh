#!/bin/sh

# copy the json schemas from the dependencies to the local folder
node test/dev/generate-external-schemas.js

# somehow redocly has problems with the json schema references from already referenced files.
# so we bundle the api docs first and then build the docs.
npx @redocly/cli bundle -o docs/openapi/api-service.bundle.yaml api-service@v1

# then build the docs
npx @redocly/cli build-docs -o docs/api.html api-service-bundled@v1
