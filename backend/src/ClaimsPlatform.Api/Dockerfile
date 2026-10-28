# Build from repository root: docker build -f backend/src/ClaimsPlatform.Api/Dockerfile -t claims-platform-api .
FROM mcr.microsoft.com/dotnet/sdk:8.0 AS build
WORKDIR /src
COPY backend/ClaimsPlatform.sln ./
COPY backend/src/ClaimsPlatform.Api/ClaimsPlatform.Api.csproj backend/src/ClaimsPlatform.Api/
RUN dotnet restore backend/src/ClaimsPlatform.Api/ClaimsPlatform.Api.csproj
COPY backend/src/ClaimsPlatform.Api/ backend/src/ClaimsPlatform.Api/
WORKDIR /src/backend/src/ClaimsPlatform.Api
RUN dotnet publish ClaimsPlatform.Api.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:8.0 AS final
WORKDIR /app
ENV ASPNETCORE_URLS=http://+:8080
ENV DocumentStorage__Path=/data/uploads
ENV ConnectionStrings__Default="Data Source=/data/claims.db"
EXPOSE 8080
COPY --from=build /app/publish .
RUN mkdir -p /data/uploads && chown -R $APP_UID:$APP_UID /data
USER $APP_UID
ENTRYPOINT ["dotnet", "ClaimsPlatform.Api.dll"]
