# Azure Region and Client IP Viewer

A minimal single-page web application that displays both the Azure region where it's deployed and the client's IP address (IPv4 and IPv6). This app is particularly useful for testing network configurations, load balancers, and understanding client IP behavior in different Azure deployment scenarios.

## Features

- **Azure Region Detection**: Automatically detects the Azure region using environment variables and Azure Instance Metadata Service (IMDS)
- **Client IP Display**: Shows the requesting client's IP address with proper IPv4/IPv6 support
- **Clean IP Formatting**: 
  - Removes port numbers from IP addresses
  - Handles IPv4-mapped IPv6 addresses (`::ffff:192.168.1.1` → `192.168.1.1`)
  - Displays full IPv6 addresses without truncation
- **Multiple Deployment Support**: Works with direct VM deployment, load balancers, proxies, and container services
- **Dual-Stack Networking**: Supports both IPv4 and IPv6 clients
- **Responsive UI**: Clean, modern interface that works on all devices

## Getting Started Locally

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Run the application:**
   ```bash
   npm start
   ```

3. **Open in browser:**
   ```
   http://localhost:3000
   ```

## Entra-authenticated app variant (application code)

This repository now includes a separate server variant with app-level Microsoft Entra authentication:

- `server.entra.js` (does not modify existing `server.js` behavior)
- `npm run start:entra` / `npm run dev:entra`
- `.env.entra.example` for required configuration

### Required environment variables

- `ENTRA_TENANT_ID`
- `ENTRA_CLIENT_ID`
- `ENTRA_CLIENT_SECRET`
- `ENTRA_REDIRECT_URI` **or** `PUBLIC_BASE_URL`

If `ENTRA_REDIRECT_URI` is not set, callback defaults to:

`<PUBLIC_BASE_URL>/auth/callback`

This allows forcing the callback host to your Application Gateway public FQDN.

### Entra app registration setup

For the app registration used by `server.entra.js`:

- Add Web redirect URI: `https://<your-public-host>/auth/callback`
- Add post-logout redirect URI if desired
- Ensure ID token issuance is enabled

### Run

```bash
npm run start:entra
```

### Run with Docker (Entra variant)

```bash
# Build dedicated Entra image
docker build -f Dockerfile.entra -t azure-region-viewer:entra .

# Run with your Entra environment variables
docker run --env-file .env.entra -p 3000:3000 azure-region-viewer:entra
```

## How Region Detection Works

The server attempts to detect the Azure region in this order:
1. **Environment variables**: `AZURE_REGION`, `REGION_NAME`, `WEBSITE_REGION`, `REGION`, `LOCATION`
2. **Azure Instance Metadata Service (IMDS)**: Calls `169.254.169.254/metadata/instance` to read `compute.location`
3. **Fallback**: Returns "local" if running outside Azure or detection fails

## Client IP Detection

The application uses advanced client IP detection that works across different deployment scenarios:

- **Proxy Headers**: Checks `X-Forwarded-For`, `X-Real-IP`, `X-Client-IP`, and other common headers
- **Azure-Specific Headers**: Supports `X-Azure-ClientIP` and other Azure load balancer headers
- **Direct Connection**: Falls back to socket connection information when no proxy headers are present
- **Private IP Detection**: Identifies when showing Docker bridge or private network IPs vs real client IPs

## Docker Images

Two optimized Docker images are available on Docker Hub:

### Standard Image: `madedroo/azure-region-viewer:latest`
- **Use case**: Behind load balancers, proxies, Azure Container Instances
- **Client IP source**: HTTP headers (X-Forwarded-For, etc.)
- **Networking**: Standard Docker bridge networking
- **IPv6 Support**: Limited to proxy-forwarded connections

### Host Network Image: `madedroo/azure-region-viewer:hostnet` 
- **Use case**: Direct VM deployment with public IPs
- **Client IP source**: Direct socket connections + HTTP headers
- **Networking**: Host networking mode (shares VM's network stack)
- **IPv6 Support**: Full dual-stack IPv4/IPv6 support
- **Why needed**: Preserves real client IPs, prevents Docker bridge network interference

## Deployment Scenarios

### 1. Behind Azure Application Gateway / Load Balancer
```bash
docker run -p 3000:3000 madedroo/azure-region-viewer:latest
```
- ✅ Client IP comes from `X-Forwarded-For` header
- ✅ Works with both IPv4 and IPv6 clients
- ✅ Standard container networking

### 2. Direct VM with Public IP (Recommended for IPv6)
```bash
docker run --network=host madedroo/azure-region-viewer:hostnet
```
- ✅ Real client IPs preserved (no Docker bridge interference)
- ✅ Full IPv6 support - container listens on `:::3000`
- ✅ No port mapping needed (uses host network directly)
- ✅ Ideal for testing IPv6 connectivity

### 3. Azure Container Instances
```bash
# ACI automatically handles client IP forwarding
az container create --resource-group myRG --name myapp \
  --image madedroo/azure-region-viewer:latest \
  --ports 80 --ip-address Public
```
- ✅ ACI provides automatic client IP detection
- ✅ Works with standard image

### 4. With nginx Reverse Proxy (SSL Termination)
```nginx
location / {
    proxy_pass http://127.0.0.1:3000;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_set_header Host $host;
}
```

## Key Technical Improvements

### IPv6 Support Enhancements
- **Problem**: Container only listened on IPv4 (`0.0.0.0`), IPv6 clients couldn't connect
- **Solution**: Changed binding to `::` for dual-stack IPv4/IPv6 support
- **Result**: Both `curl -4 localhost:3000` and `curl -6 localhost:3000` now work

### Client IP Detection Fixes
- **Problem**: Docker bridge networking caused IPv6 clients to show as `172.17.0.1`
- **Solution**: Host network mode + enhanced IP detection logic
- **Result**: Real IPv6 client addresses properly displayed

### IP Address Display Improvements
- **IPv6 Port Handling**: Removes port numbers from IPv6 addresses (e.g., `2001:db8::1:5000` → `2001:db8::1`)
- **IPv4-Mapped IPv6 Cleanup**: Converts `::ffff:192.168.1.1` to `192.168.1.1`
- **Full IPv6 Display**: No more truncation of long IPv6 addresses

### Enhanced Debugging
The `/api/region` endpoint now provides comprehensive debugging information:
```json
{
  "region": "eastus",
  "clientIp": "2001:db8::1",
  "isPrivateIP": false,
  "connectionInfo": {
    "remoteAddress": "2001:db8::1",
    "remoteFamily": "IPv6"
  },
  "allHeaders": {
    "x-forwarded-for": null,
    "x-real-ip": null
  },
  "deploymentAdvice": "Public IP detected successfully"
}
```

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

## API Endpoint

**GET `/api/region`**

Returns JSON with region and client IP information:
```json
{
  "region": "eastus",
  "clientIp": "2001:db8::1",
  "xForwardedFor": null,
  "remoteAddress": "2001:db8::1", 
  "isPrivateIP": false,
  "expressIp": "2001:db8::1",
  "connectionInfo": {
    "remoteAddress": "2001:db8::1",
    "remoteFamily": "IPv6",
    "localAddress": ":::",
    "localPort": 3000
  },
  "allHeaders": {
    "x-forwarded-for": null,
    "x-real-ip": null,
    "x-client-ip": null
  },
  "deploymentAdvice": "Public IP detected successfully"
}
```

## Environment Variables

- `PORT`: Server port (default: 3000)
- `HOST`: Bind address (default: `::` for dual-stack)
- `AZURE_REGION`: Override region detection
- Any of: `REGION_NAME`, `WEBSITE_REGION`, `REGION`, `LOCATION`

## Building from Source

```bash
# Standard image
docker build -t azure-region-viewer:latest .

# Host network optimized image  
docker build -f Dockerfile.hostnet -t azure-region-viewer:hostnet .

# Entra auth app-level image
docker build -f Dockerfile.entra -t azure-region-viewer:entra .

# Entra auth + host network optimized image
docker build -f Dockerfile.hostnet.entra -t azure-region-viewer:hostnet-entra .
```

Security notes:

- The Bicep template enables the ACR admin user for simplicity. For production, prefer using managed identities and assigning the AcrPull role to the Web App's principal instead of using admin credentials.
- Review the GitHub Actions workflow and replace any placeholders with your real values. Use least privilege principles for service principals.
- When using host network mode, the container shares the host's network stack - ensure proper firewall configuration.
