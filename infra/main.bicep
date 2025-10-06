param namePrefix string = 'azrvw${uniqueString(resourceGroup().id)}'
param location string = resourceGroup().location

resource acr 'Microsoft.ContainerRegistry/registries@2021-09-01' = {
  name: '${namePrefix}acr'
  location: location
  sku: {
    name: 'Basic'
  }
  properties: {
    adminUserEnabled: true
  }
}

resource appServicePlan 'Microsoft.Web/serverfarms@2021-02-01' = {
  name: '${namePrefix}-plan'
  location: location
  sku: {
    name: 'B1'
    tier: 'Basic'
    capacity: 1
  }
  kind: 'app,linux,container'
}

resource webApp 'Microsoft.Web/sites@2021-02-01' = {
  name: '${namePrefix}-site'
  location: location
  kind: 'app,linux'
  properties: {
    serverFarmId: appServicePlan.id
    siteConfig: {
      appSettings: [
        {
          name: 'WEBSITES_ENABLE_APP_SERVICE_STORAGE'
          value: 'false'
        }
      ]
    }
  }
  identity: {
    type: 'SystemAssigned'
  }
}

output acrName string = acr.name
output acrLoginServer string = acr.properties.loginServer
output webAppName string = webApp.name
output resourceGroup string = resourceGroup().name
