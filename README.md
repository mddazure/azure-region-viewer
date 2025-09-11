Azure Region Viewer

A minimal single-page app that shows the Azure region where it is deployed.

Getting started

1. Install dependencies: npm install
2. Run locally: npm start
3. Open http://localhost:3000

How region is detected

- The server first checks environment variables (AZURE_REGION, REGION_NAME, WEBSITE_REGION, etc.).
- If not found it attempts to call the Azure Instance Metadata Service (IMDS) at 169.254.169.254 to read compute.location.
- If none of the above are available the API returns "local".

Deploying

This app can be deployed to Azure App Service or as a container. Set the AZURE_REGION environment variable if your hosting platform does not expose region information directly.

## Azure deployment (ACR + Web App for Containers)

This repository now contains:

- `infra/main.bicep` — Bicep template that provisions an Azure Container Registry (ACR), an App Service Plan, and a Linux Web App for Containers. For simplicity the ACR is created with the admin user enabled (good for demos). For production use, prefer managed identities and RBAC.
- `infra/main.parameters.json` — parameter file for the Bicep template.
- `.github/workflows/deploy-container.yml` — GitHub Actions workflow that:
  1. Logs in to Azure using OIDC (federated credentials).
  2. Deploys the Bicep template to a resource group.
  3. Retrieves ACR credentials and pushes the container image.
  4. Configures the Web App for Containers to use the pushed image.

Required GitHub repository secrets (set in the `dev` environment):

- `AZURE_CLIENT_ID` — the app registration (service principal) client id. Configure a federated credential for GitHub Actions (see below).
- `AZURE_TENANT_ID` — Azure tenant id.
- `AZURE_SUBSCRIPTION_ID` — Azure subscription id.
- `AZURE_RESOURCE_GROUP` — name of the resource group to deploy into (must exist).
- `NAME_PREFIX` — prefix used to name resources (e.g. `azrvw`), or empty to use a generated string.
- `AZURE_LOCATION` — Azure region for resources (e.g. `eastus`).

Notes about setup (high level):

1. Create an Azure AD application and grant it contributor rights in the target subscription. Then add a federated credential that allows the GitHub repository environment `dev` to request tokens for that app. Example (run locally with Azure CLI + GitHub CLI):

   - Create a service principal and note the app id:
     az ad sp create-for-rbac --name "azure-region-viewer-github" --role Contributor --scopes /subscriptions/<SUBSCRIPTION_ID>

   - Create the federated credential for the app registration (replace placeholders):
     az ad app federated-credential create --id <APP_ID> --parameters '{"name":"github-federated","issuer":"https://token.actions.githubusercontent.com","subject":"repo:<GITHUB_ORG>/<REPO>:environment:dev","audiences":["api://AzureADTokenExchange"]}'

   - Create the `dev` environment in your GitHub repo and add the required secrets (use `gh` CLI or the UI):
     gh api --method PUT -H "Accept: application/vnd.github+json" repos/<ORG>/<REPO>/environments/dev
     gh secret set AZURE_CLIENT_ID --body <APP_ID> --env dev
     gh secret set AZURE_TENANT_ID --body <TENANT_ID> --env dev
     gh secret set AZURE_SUBSCRIPTION_ID --body <SUBSCRIPTION_ID> --env dev
     gh secret set AZURE_RESOURCE_GROUP --body <RESOURCE_GROUP> --env dev
     gh secret set NAME_PREFIX --body <NAME_PREFIX> --env dev
     gh secret set AZURE_LOCATION --body <LOCATION> --env dev

2. Push to the `main` branch to trigger the workflow. The workflow will deploy the infra and publish the container image.

Security notes:

- The Bicep template enables the ACR admin user for simplicity. For production, prefer using managed identities and assigning the AcrPull role to the Web App's principal instead of using admin credentials.
- Review the GitHub Actions workflow and replace any placeholders with your real values. Use least privilege principles for service principals.
